#!/usr/bin/env node
// Release gate: proves the in-app update hop N-1 -> N on a PACKAGED app before a Mac beta may switch
// the live update feed (RUNBOOK: "NEVER BREAK IN-APP UPDATE"). Real Mac, real Launch Services.
//
//   node nondev/scripts/release/update-hop-check.mjs \
//     --previous ~/skycot-release/<N-1>/SKYCOT-<N-1>-arm64.dmg   (or an .app folder)
//     --channel latest|staging                                    (which feed the update comes from)
//     --out <folder for screenshots + report.html>
//     [--paths header,code] [--expect-version <N>] [--feed-base <url>]
//     [--cdp-port 9335] [--engine-port 47395]
//
// For each restart path (default: both) it: installs N-1 into ~/Applications/SKYCOT.app (refuses if
// that path exists), launches it with a throwaway HOME / engine home / port / user-data name, sets up
// a two-child family with a throwaway parent code, unlocks as the grown-up from the picker, picks the
// channel, checks for the update, waits for the download, then presses "Restart now":
//   header = the grown-up is unlocked, the proof travels as a header (the grown-up-mode path);
//   code   = the page is reloaded so the in-memory proof is gone, and the parent-code sheet is used.
// It asserts the app quit within 30 s, ShipIt logged "Successfully launched application", the bundle
// reports version N, and the relaunched process was killed and the copy removed within seconds.
// Everything it made is cleaned up on exit, also on failure. Exit 0 = every path passed.
//
// Why Launch Services from ~/Applications: a copy run from /tmp never quits (Squirrel stages the
// update but ShipIt does not swap), and a directly exec'd app keeps a relative command line. ShipIt
// relaunches the app WITHOUT the env overrides, so the relaunched copy is killed at once, before it
// can open on the real home.
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { randomInt } from "node:crypto";

const HOME = homedir();
const APP = path.join(HOME, "Applications", "SKYCOT.app");
const SHIPIT_LOG = path.join(
  HOME,
  "Library",
  "Caches",
  "com.skycot.app.ShipIt",
  "ShipIt_stderr.log",
);
const PLAYWRIGHT =
  process.env.SKYCOT_PLAYWRIGHT ??
  "/Users/me/t3code-nondev/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs";
const SPAWN_TIMEOUT = 120_000;

// ---------------------------------------------------------------------------------------------
// Pure helpers (exported for the unit test).
// ---------------------------------------------------------------------------------------------
export function parseArgs(argv) {
  const opts = {
    previous: null,
    channel: null,
    out: null,
    paths: ["header", "code"],
    expectVersion: null,
    feedBase: "https://downloads.skycot.com/mac",
    cdpPort: 9335,
    enginePort: 47395,
  };
  const need = (i, flag) => {
    if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--previous") opts.previous = path.resolve(need(i++, flag));
    else if (flag === "--channel") opts.channel = need(i++, flag);
    else if (flag === "--out") opts.out = path.resolve(need(i++, flag));
    else if (flag === "--paths")
      opts.paths = need(i++, flag)
        .split(",")
        .map((s) => s.trim());
    else if (flag === "--expect-version") opts.expectVersion = need(i++, flag);
    else if (flag === "--feed-base") opts.feedBase = need(i++, flag).replace(/\/+$/, "");
    else if (flag === "--cdp-port") opts.cdpPort = Number(need(i++, flag));
    else if (flag === "--engine-port") opts.enginePort = Number(need(i++, flag));
    else throw new Error(`unknown option ${flag}`);
  }
  if (!opts.previous) throw new Error("--previous <N-1 dmg or .app> is required");
  if (opts.channel !== "latest" && opts.channel !== "staging")
    throw new Error("--channel must be latest or staging");
  if (!opts.out) throw new Error("--out <folder> is required");
  for (const p of opts.paths)
    if (p !== "header" && p !== "code") throw new Error(`unknown path ${p}`);
  if (opts.paths.length === 0) throw new Error("--paths needs header and/or code");
  return opts;
}

/** The `version:` line of an electron-updater yml. */
export function parseFeedVersion(yml) {
  const m = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(yml);
  return m ? m[1] : null;
}

/** Process lines (`pid ppid command`) that belong to the test bundle. */
export function bundleProcesses(psOutput, appPath, { skipShipIt = false } = {}) {
  const out = [];
  for (const line of psOutput.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    if (skipShipIt && m[3].includes("Squirrel.framework/Resources/ShipIt")) continue; // the installer lives inside the bundle; killing it breaks the swap
    if (m[3].includes(`${appPath}/Contents/`))
      out.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] });
  }
  return out;
}

/** The main (non-helper) process of the bundle. */
export function mainProcess(procs) {
  return procs.find(
    (p) => p.command.includes("/Contents/MacOS/") && !p.command.includes("--type="),
  );
}

export function escapeHtml(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

// ---------------------------------------------------------------------------------------------
// Runtime.
// ---------------------------------------------------------------------------------------------
class HopFailure extends Error {}
const fail = (reason) => {
  throw new HopFailure(reason);
};
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(stamp(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = (cmd, args, options = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", timeout: SPAWN_TIMEOUT, ...options });
const psAll = () => run("ps", ["-axo", "pid=,ppid=,command="]).stdout ?? "";

function killTestApps(opts) {
  // Only OUR processes: the test bundle's path (under ~/Applications) and our CDP port. Never
  // /Applications/SKYCOT.app, never anything by folder name alone.
  for (let round = 0; round < 3; round += 1) {
    const ps = psAll();
    const pids = new Set(bundleProcesses(ps, APP).map((p) => p.pid));
    for (const line of ps.split("\n")) {
      const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      if (m && m[3].includes(`--remote-debugging-port=${opts.cdpPort}`)) pids.add(Number(m[1]));
    }
    pids.delete(process.pid);
    if (pids.size === 0) return;
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    run("sleep", ["0.3"]);
  }
}

/** A failed hop can leave Squirrel's ShipIt retrying an install into our test path; stop that. */
function cleanShipItLeftovers() {
  const dir = path.join(HOME, "Library", "Caches", "com.skycot.app.ShipIt");
  const statePath = path.join(dir, "ShipItState.plist");
  if (!existsSync(statePath)) return;
  let target = "";
  try {
    target = readFileSync(statePath, "utf8");
  } catch {}
  if (!target.split("\\/").join("/").includes(`${APP}/`)) return;
  run("launchctl", ["remove", "com.skycot.app.ShipIt"]);
  rmSync(statePath, { force: true });
  for (const n of readdirSync(dir))
    if (n.startsWith("update.")) rmSync(path.join(dir, n), { recursive: true, force: true });
}

function plistVersion(appPath) {
  const r = run("plutil", [
    "-extract",
    "CFBundleShortVersionString",
    "raw",
    "-o",
    "-",
    path.join(appPath, "Contents", "Info.plist"),
  ]);
  return r.status === 0 ? r.stdout.trim() : null;
}

function installPrevious(previous, state) {
  mkdirSync(path.dirname(APP), { recursive: true });
  if (existsSync(APP))
    fail(
      `${APP} already exists. The gate will not overwrite it; move or delete that copy yourself and run again.`,
    );
  let source = previous;
  if (previous.endsWith(".dmg")) {
    const mount = path.join(state.work, "mnt");
    mkdirSync(mount, { recursive: true });
    const a = run("hdiutil", [
      "attach",
      "-nobrowse",
      "-readonly",
      "-noverify",
      "-noautoopen",
      "-mountpoint",
      mount,
      previous,
    ]);
    if (a.status !== 0)
      fail(
        `could not open the previous release image: ${(a.stderr || a.stdout).trim().slice(0, 200)}`,
      );
    state.mount = mount;
    const found = readdirSync(mount).find((n) => n.endsWith(".app"));
    if (!found) fail("the previous release image has no .app inside");
    source = path.join(mount, found);
  }
  const c = run("ditto", [source, APP]);
  state.installed = true;
  if (c.status !== 0)
    fail(
      `could not copy the previous app into ~/Applications: ${(c.stderr || "").trim().slice(0, 200)}`,
    );
  if (state.mount) {
    run("hdiutil", ["detach", "-force", state.mount]);
    state.mount = null;
  }
}

function launch(opts, state) {
  const userData = state.userDataName;
  const env = [
    `HOME=${state.home}`,
    `T3CODE_HOME=${path.join(state.home, ".skycot")}`,
    `T3CODE_PORT=${opts.enginePort}`,
    `T3CODE_DESKTOP_USER_DATA_DIR=${userData}`,
  ];
  const args = ["-n"];
  for (const e of env) args.push("--env", e);
  args.push(APP, "--args", "--use-mock-keychain", `--remote-debugging-port=${opts.cdpPort}`);
  const r = run("open", args);
  if (r.status !== 0)
    fail(`Launch Services would not open the test app: ${(r.stderr || "").trim().slice(0, 200)}`);
}

async function waitFor(what, timeoutMs, fn, everyMs = 500) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch {}
    await sleep(everyMs);
  }
  fail(`timed out waiting for ${what}`);
}

function randomCode() {
  for (;;) {
    const n = String(randomInt(1000, 10000));
    if (/^(\d)\1+$/.test(n)) continue;
    if ("0123456789".includes(n) || "9876543210".includes(n)) continue;
    return n;
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`update-hop-check: ${e.message}`);
    process.exit(2);
  }
  mkdirSync(opts.out, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(),
    opts,
    paths: [],
    verdict: "FAILED",
    reason: "",
  };
  let pw = null;
  const state = { work: null, home: null, userDataName: null, installed: false, mount: null };

  const cleanup = () => {
    killTestApps(opts);
    if (state.mount) run("hdiutil", ["detach", "-force", state.mount]);
    cleanShipItLeftovers();
    if (state.installed && existsSync(APP)) rmSync(APP, { recursive: true, force: true });
    if (state.userDataName) {
      const ud = path.join(HOME, "Library", "Application Support", state.userDataName);
      if (
        path.basename(ud) === state.userDataName &&
        state.userDataName.startsWith("skycot-hopcheck-")
      )
        rmSync(ud, { recursive: true, force: true });
    }
    if (state.work && state.work.includes("skycot-hopcheck-"))
      rmSync(state.work, { recursive: true, force: true });
    state.installed = false;
  };
  const onSignal = () => {
    cleanup();
    process.exit(130);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const watchdog = setTimeout(() => {
    log("overall time limit reached");
    cleanup();
    process.exit(3);
  }, 15 * 60_000);

  try {
    // ---- preflight ----------------------------------------------------------------------
    if (process.platform !== "darwin")
      fail("this gate only runs on a Mac (it uses Launch Services)");
    if (!existsSync(opts.previous)) fail(`previous release not found: ${opts.previous}`);
    if (!existsSync(PLAYWRIGHT))
      fail(`Playwright not found at ${PLAYWRIGHT} (set SKYCOT_PLAYWRIGHT)`);
    if (existsSync(APP))
      fail(
        `${APP} already exists. The gate will not overwrite it; move or delete that copy yourself.`,
      );
    cleanShipItLeftovers(); // a stale install request from an earlier run would poison this one
    if (
      existsSync(path.join(HOME, "Library", "Caches", "com.skycot.app.ShipIt", "ShipItState.plist"))
    )
      fail(
        "Squirrel has an unfinished update recorded in ~/Library/Caches/com.skycot.app.ShipIt (not ours). Let the real app finish updating, then run again.",
      );
    if (bundleProcesses(psAll(), APP).length > 0)
      fail("a test copy of SKYCOT is already running from ~/Applications");
    for (const port of [opts.cdpPort, opts.enginePort]) {
      const l = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
      if ((l.stdout || "").trim()) fail(`port ${port} is already in use by another program`);
    }
    const { chromium } = await import(PW_URL());
    pw = chromium;

    const feedUrl = `${opts.feedBase}/${opts.channel}-mac.yml`;
    let feedText;
    try {
      const res = await fetch(feedUrl, { headers: { "cache-control": "no-cache" } });
      if (!res.ok)
        fail(
          `the ${opts.channel} feed ${feedUrl} answered ${res.status}: upload ${opts.channel}-mac.yml first`,
        );
      feedText = await res.text();
    } catch (e) {
      if (e instanceof HopFailure) throw e;
      fail(`could not read the ${opts.channel} feed ${feedUrl}: ${e.message}`);
    }
    const feedVersion = parseFeedVersion(feedText);
    if (!feedVersion) fail(`the ${opts.channel} feed has no version line`);
    const expected = opts.expectVersion ?? feedVersion;
    report.expectedVersion = expected;
    log(
      `feed ${opts.channel}-mac.yml offers ${feedVersion}; expecting the app to land on ${expected}`,
    );

    // ---- one hop per restart path ------------------------------------------------------------
    for (const restartPath of opts.paths) {
      const result = { path: restartPath, steps: [], shots: [], ok: false, reason: "" };
      report.paths.push(result);
      state.work = mkdtempSync(path.join(tmpdir(), "skycot-hopcheck-"));
      state.home = path.join(state.work, "home");
      mkdirSync(path.join(state.home, ".skycot"), { recursive: true });
      state.userDataName = `skycot-hopcheck-${Date.now().toString(36)}`;
      const code = randomCode();
      try {
        await runHop({ chromium, opts, state, result, restartPath, code, expected });
        result.ok = true;
      } catch (e) {
        result.reason = e instanceof HopFailure ? e.message : `unexpected error: ${e.stack || e}`;
        throw e;
      } finally {
        cleanup();
      }
    }
    report.verdict = "PASSED";
    report.reason = "";
  } catch (e) {
    report.verdict = "FAILED";
    report.reason = e instanceof HopFailure ? e.message : `unexpected error: ${e.stack || e}`;
  } finally {
    clearTimeout(watchdog);
    cleanup();
    report.finishedAt = new Date().toISOString();
    writeFileSync(path.join(opts.out, "report.json"), JSON.stringify(report, null, 2));
    writeFileSync(path.join(opts.out, "report.html"), renderReport(report));
  }
  if (report.verdict === "PASSED") {
    log(
      `PASSED: ${report.paths.map((p) => p.path).join(" + ")} hop(s) reached ${report.expectedVersion}. Report: ${path.join(opts.out, "report.html")}`,
    );
    process.exit(0);
  }
  console.error(`\nFAILED: ${report.reason}\nReport: ${path.join(opts.out, "report.html")}`);
  process.exit(1);
}

const PW_URL = () => (PLAYWRIGHT.startsWith("file:") ? PLAYWRIGHT : `file://${PLAYWRIGHT}`);

async function runHop({ chromium, opts, state, result, restartPath, code, expected }) {
  const t0 = Date.now();
  const step = async (name, fn) => {
    const s = { name, ok: false, ms: 0, note: "" };
    result.steps.push(s);
    const started = Date.now();
    log(`[${restartPath}] ${name}`);
    try {
      const note = await fn();
      s.ok = true;
      s.note = typeof note === "string" ? note : "";
    } catch (e) {
      s.note = e instanceof HopFailure ? e.message : String(e);
      throw e;
    } finally {
      s.ms = Date.now() - started;
    }
  };
  let page = null;
  let browser = null;
  const shot = async (name) => {
    if (!page) return;
    const file = `${restartPath}-${String(result.shots.length + 1).padStart(2, "0")}-${name}.png`;
    try {
      await page.screenshot({ path: path.join(opts.out, file), timeout: 8000 });
      result.shots.push({ file, label: name });
    } catch {}
  };
  const text = () => page.evaluate(() => document.body.innerText).catch(() => "");
  const dialogs = () =>
    page
      .evaluate(() =>
        [...document.querySelectorAll('[role="dialog"]')]
          .map((d) => d.innerText.replace(/\n/g, " | "))
          .join(" || "),
      )
      .catch(() => "");
  const tryAgain = async () => {
    for (let i = 0; i < 6; i += 1) {
      const retry = page.getByRole("button", { name: /^Try again$/ });
      if (await retry.count()) {
        await retry.first().click();
        await page.waitForTimeout(4000);
      } else break;
    }
  };
  const updateState = () =>
    page.evaluate(() => window.desktopBridge.getUpdateState()).catch(() => null);
  const seen = [];
  const api = (p, body, method = "POST") =>
    page.evaluate(
      async ([p, body, method]) => {
        const tok = await window.desktopBridge.getLocalEnvironmentBearerToken();
        const abs = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => /^https?:\/\/[^/]+\/api\//.test(n));
        const base = abs ? abs.replace(/\/api\/.*$/, "") : null;
        if (!tok || !base) return { status: 0, body: null };
        const r = await fetch(`${base}/api/skycot/family${p}`, {
          method,
          headers: {
            authorization: `Bearer ${tok}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        let j = null;
        try {
          j = await r.json();
        } catch {}
        return { status: r.status, body: j };
      },
      [p, body, method],
    );
  const connect = async () => {
    for (let i = 0; i < 60; i += 1) {
      try {
        return await chromium.connectOverCDP(`http://127.0.0.1:${opts.cdpPort}`);
      } catch {
        await sleep(1000);
      }
    }
    return null;
  };

  try {
    await step("install the previous release into ~/Applications", async () => {
      installPrevious(opts.previous, state);
      const v = plistVersion(APP);
      result.previousVersion = v;
      if (!v) fail("the copied previous app has no readable version");
      if (v === expected)
        fail(`the previous app is already version ${v}; the hop would prove nothing`);
      return `previous app is ${v}, expecting ${expected}`;
    });
    const shipitBefore = existsSync(SHIPIT_LOG) ? statSync(SHIPIT_LOG).size : 0;

    await step("launch it through Launch Services with throwaway home", async () => {
      launch(opts, state);
      browser = await connect();
      if (!browser) fail("the test app never opened its debugging port (did it crash on start?)");
      page = await waitFor("the app window", 60_000, async () =>
        browser
          .contexts()[0]
          ?.pages()
          .find((p) => !p.url().startsWith("devtools")),
      );
      const main = mainProcess(bundleProcesses(psAll(), APP));
      if (!main) fail("could not find the test app's main process");
      state.mainPid = main.pid;
      if (!main.command.includes(`--remote-debugging-port=${opts.cdpPort}`))
        fail("the main process is not the one we launched");
      await page.waitForTimeout(6000);
      await tryAgain();
      await shot("launched");
    });

    await step("set up a two-child family with a throwaway parent code", async () => {
      await waitFor("the engine bearer token", 60_000, () =>
        page.evaluate(async () => !!(await window.desktopBridge.getLocalEnvironmentBearerToken())),
      );
      let enabled = { status: 0 };
      for (let i = 0; i < 20 && enabled.status !== 200; i += 1) {
        enabled = await api("/enable", { code, childName: "Ava", timeZone: "Australia/Melbourne" });
        if (enabled.status !== 200) await sleep(1500);
      }
      if (enabled.status !== 200)
        fail(`the engine would not enable the family profile (status ${enabled.status})`);
      const ver = await api("/verify", { code, purpose: "settings" });
      if (ver.status !== 200) fail(`the engine rejected the throwaway code (status ${ver.status})`);
      const add = await api("/children/add", {
        child: { name: "Leo" },
        timeZone: "Australia/Melbourne",
      });
      if (add.status !== 200) fail(`could not add the second child (status ${add.status})`);
      const welcome = await api("/welcome", { state: "done" });
      if (welcome.status !== 200)
        fail(`could not mark the welcome done (status ${welcome.status})`);
      const lock = await api("/lock", {});
      if (lock.status !== 200) fail(`could not lock the family profile (status ${lock.status})`);
      const st = await api("", undefined, "GET");
      const kids = ((st.body && st.body.children) || []).length;
      if (kids !== 2) fail(`expected two children, the engine reports ${kids}`);
      return "two children, welcome done, locked";
    });

    const unlockAsGrownUp = async () => {
      await page.evaluate(() => {
        try {
          localStorage.removeItem("skycot:family:last-child");
          sessionStorage.clear();
        } catch {}
        location.reload();
      });
      await page.waitForTimeout(6000);
      await tryAgain();
      if (!(await text()).includes("Who's using SKYCOT?"))
        fail("the who's-using picker did not appear");
      await shot("picker");
      await page
        .locator(".fm-picker button", { hasText: /Grown-up/ })
        .first()
        .click();
      await page.waitForTimeout(800);
      const field = page.locator('.fm-picker input[type="password"]').first();
      await field.waitFor({ timeout: 8000 });
      await field.fill(code);
      await waitFor(
        "the picker to close after the code",
        20_000,
        async () => !(await text()).includes("Who's using SKYCOT?"),
      );
    };
    await step("unlock as the grown-up from the picker", async () => {
      await unlockAsGrownUp();
      await shot("grown-up");
    });

    await step(`select the ${opts.channel} channel and check for the update`, async () => {
      if (opts.channel !== "latest") {
        const res = await page.evaluate(async (ch) => {
          try {
            const s = await window.desktopBridge.setUpdateChannel(ch);
            return { ok: true, channel: s && s.channel };
          } catch (e) {
            return { ok: false, error: String(e && e.message ? e.message : e) };
          }
        }, opts.channel);
        if (!res.ok)
          fail(
            `the previous app does not understand the ${opts.channel} channel (${res.error.slice(0, 120)}). Staging needs an N-1 build that already contains the staging channel.`,
          );
        if (res.channel !== opts.channel)
          fail(`asked for the ${opts.channel} channel but the app reports ${res.channel}`);
      }
      await page.evaluate(() => window.desktopBridge.checkForUpdate().catch(() => null));
    });

    await step("wait for the update to download", async () => {
      let st = null;
      const end = Date.now() + 240_000;
      let lastNote = 0;
      while (Date.now() < end) {
        st = await updateState();
        if (st && st.status === "downloaded") break;
        if (st && st.status === "error")
          fail(`the updater reported an error: ${String(st.message).slice(0, 160)}`);
        if (Date.now() - lastNote > 20_000) {
          log(
            `  updater: ${st && st.status} ${st && st.downloadPercent != null ? Math.round(st.downloadPercent) + "%" : ""}`,
          );
          lastNote = Date.now();
        }
        if (st && st.status === "up-to-date" && Date.now() > end - 200_000)
          fail(
            `the ${opts.channel} feed offers no newer version than the previous app (${result.previousVersion})`,
          );
        await sleep(2000);
      }
      if (!st || st.status !== "downloaded")
        fail(`the update did not finish downloading in 4 minutes (status ${st && st.status})`);
      if (st.downloadedVersion && st.downloadedVersion !== expected)
        fail(`the app downloaded ${st.downloadedVersion}, expected ${expected}`);
      await shot("update-ready");
      return `downloaded ${st.downloadedVersion ?? expected}`;
    });

    page.on("response", (r) => {
      const u = r.url();
      if (/\/api\/skycot\/(family\/(verify|prepare-update|renew)|updates)/.test(u))
        seen.push({
          m: r.request().method(),
          p: u.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, ""),
          s: r.status(),
        });
    });

    {
      await step("make sure the grown-up is still unlocked", async () => {
        await tryAgain();
        if (await page.locator(".fm-picker").count()) {
          // The page can fall back to the picker while the engine is busy; unlock again, no reload.
          await page
            .locator(".fm-picker button", { hasText: /Grown-up/ })
            .first()
            .click();
          await page.waitForTimeout(800);
          const field = page.locator('.fm-picker input[type="password"]').first();
          await field.waitFor({ timeout: 8000 });
          await field.fill(code);
          await waitFor(
            "the picker to close after the code",
            20_000,
            async () => (await page.locator(".fm-picker").count()) === 0,
          );
          await shot("grown-up-again");
          return "had to unlock again";
        }
        return "still unlocked";
      });
    }

    if (restartPath === "code") {
      await step(
        "take the engine's grown-up proof away while the window still shows grown-up mode",
        async () => {
          // The Mac page keeps its proof in memory only. Locking the profile on the engine makes that
          // proof worthless the same way a lost or expired one is: grown-up shortcut refused, code sheet.
          const lock = await api("/lock", {});
          if (lock.status !== 200)
            fail(`could not lock the profile on the engine (status ${lock.status})`);
          await shot("proof-gone");
          return "profile locked on the engine; the window still looks unlocked";
        },
      );
    }

    await step("open the update sheet from the title-bar pill", async () => {
      const pill = page
        .getByRole("button", { name: /new version is ready|Restart to update/i })
        .first();
      await waitFor("the update pill", 30_000, async () => (await pill.count()) > 0);
      await pill.click();
      await waitFor("the update sheet", 10_000, async () => (await dialogs()).length > 0);
      await shot("sheet");
      return (await dialogs()).slice(0, 200);
    });

    // Watch for the relaunched app from the moment we press the button: it starts WITHOUT the env
    // overrides and must be killed before it opens on the real home.
    let relaunchKilledAt = null;
    let relaunchSeenAt = null;
    let oldGoneAt = null;
    const oldPids = new Set(bundleProcesses(psAll(), APP).map((p) => p.pid));
    const watcher = setInterval(() => {
      const procs = bundleProcesses(psAll(), APP, { skipShipIt: true });
      const oldMain = procs.find((p) => p.pid === state.mainPid);
      if (!oldMain && !oldGoneAt) oldGoneAt = Date.now();
      // Until the old app has really left, touch nothing: killing it early would break the install.
      if (!oldGoneAt) return;
      const fresh = procs.filter((p) => !oldPids.has(p.pid));
      if (fresh.length > 0) {
        if (!relaunchSeenAt) relaunchSeenAt = Date.now();
      }
      if (procs.length > 0) {
        for (const p of procs) {
          try {
            process.kill(p.pid, "SIGKILL");
          } catch {}
        }
        if (fresh.length > 0) relaunchKilledAt = Date.now();
      }
    }, 100);
    let pressedAt = 0;
    try {
      await step('press "Restart now"', async () => {
        const btn = page
          .locator('[role="dialog"] button', { hasText: /^Restart now$|^Restart anyway$/ })
          .first();
        await btn.click({ timeout: 8000 });
        pressedAt = Date.now();
        if (restartPath === "code") {
          const field = await waitFor("the parent-code field in the sheet", 15_000, async () => {
            const f = page.locator('[role="dialog"] input[type="password"]').last();
            return (await f.count()) > 0 ? f : null;
          });
          await shot("code-sheet");
          await field.click();
          await field.pressSequentially(code, { delay: 120 });
          await sleep(1500);
          try {
            // The code usually submits itself on the last digit and the app may already be quitting.
            const cont = page.locator('[role="dialog"] button', { hasText: /^Continue$/ }).last();
            if ((await cont.count()) && (await cont.isEnabled()))
              await cont.click({ timeout: 3000 });
          } catch {}
          await waitFor("the engine to accept the code and allow the restart", 30_000, async () => {
            const refused = seen.findIndex((x) => /prepare-update/.test(x.p) && x.s !== 200);
            const verified = seen.findIndex(
              (x, i) => i > refused && /\/family\/verify$/.test(x.path ?? x.p) && x.s === 200,
            );
            const allowed = seen.some((x) => /updates\/allow-restart/.test(x.p) && x.s === 200);
            return refused >= 0 && verified > refused && allowed;
          }).catch(() => {
            fail(
              `the parent-code sheet did not get the engine to accept the code and allow the restart. Engine answers seen: ${JSON.stringify(seen)}`,
            );
          });
        } else {
          await sleep(1500); // the page may already be gone: do not touch it
        }
        return `engine answers: ${JSON.stringify(seen)}`;
      });

      await step("the app quits within 30 seconds", async () => {
        await waitFor("the app to quit", 30_000, () => oldGoneAt !== null, 200);
        return `quit ${((oldGoneAt - pressedAt) / 1000).toFixed(1)} s after the button`;
      });
      if (restartPath === "header") {
        const bad = seen.filter((x) => /prepare-update/.test(x.p) && x.s !== 200);
        if (bad.length) fail(`prepare-update answered ${bad[0].s} for the grown-up-mode proof`);
        if (!seen.some((x) => /prepare-update/.test(x.p) && x.s === 200))
          fail("the grown-up-mode restart never got prepare-update 200 from the engine");
      }

      await step("ShipIt installs and relaunches the new version", async () => {
        const line = await waitFor(
          "ShipIt to log a successful launch",
          90_000,
          () => {
            if (!existsSync(SHIPIT_LOG)) return null;
            const buf = readFileSync(SHIPIT_LOG);
            const added = buf.subarray(Math.min(shipitBefore, buf.length)).toString("utf8");
            return (
              added
                .split("\n")
                .filter((l) => l.includes("Successfully launched application"))
                .at(-1) ?? null
            );
          },
          500,
        );
        result.shipitLine = line.trim();
        return line.trim();
      });

      await step(`the bundle now reports version ${expected}`, async () => {
        const v = await waitFor("the bundle version to change", 30_000, () => {
          const cur = plistVersion(APP);
          return cur && cur !== result.previousVersion ? cur : null;
        });
        result.newVersion = v;
        if (v !== expected) fail(`the app in ~/Applications is ${v}, expected ${expected}`);
        return v;
      });

      await step("the relaunched app was killed and the copy removed within seconds", async () => {
        const deadline = Date.now() + 20_000;
        while (!relaunchSeenAt && Date.now() < deadline) await sleep(200);
        if (!relaunchSeenAt)
          log("  (no relaunched process was seen; ShipIt may have launched and quit it already)");
        await sleep(3000); // let ShipIt finish its launch request before it is stopped with the rest
        killTestApps(opts);
        if (bundleProcesses(psAll(), APP).length > 0)
          fail("a test process is still running after the kill");
        state.installed = true;
        rmSync(APP, { recursive: true, force: true });
        state.installed = false;
        if (existsSync(APP)) fail("could not remove the test copy from ~/Applications");
        return relaunchKilledAt
          ? `relaunch killed ${(relaunchKilledAt - (oldGoneAt ?? relaunchKilledAt)) / 1000}s after the old app left`
          : "no relaunched process was left to kill";
      });
    } finally {
      clearInterval(watcher);
    }
    result.seconds = Math.round((Date.now() - t0) / 1000);
  } finally {
    try {
      await browser?.close();
    } catch {}
  }
}

function renderReport(r) {
  const ok = r.verdict === "PASSED";
  const rows = (p) =>
    p.steps
      .map(
        (s) =>
          `<tr><td class="${s.ok ? "ok" : "bad"}">${s.ok ? "&#10003;" : "&#10007;"}</td><td>${escapeHtml(s.name)}</td><td class="n">${(s.ms / 1000).toFixed(1)} s</td><td class="note">${escapeHtml(s.note).slice(0, 400)}</td></tr>`,
      )
      .join("");
  const sections = r.paths
    .map(
      (
        p,
      ) => `<section><h2>${p.path === "header" ? "Grown-up mode (proof travels as a header)" : "Parent-code sheet (page reloaded first)"} &mdash; ${p.ok ? "passed" : "FAILED"}</h2>
<p class="meta">${escapeHtml(p.previousVersion ?? "?")} &rarr; ${escapeHtml(p.newVersion ?? "not reached")}${p.shipitLine ? `<br>ShipIt: <code>${escapeHtml(p.shipitLine)}</code>` : ""}${p.reason ? `<br><b>${escapeHtml(p.reason)}</b>` : ""}</p>
<table>${rows(p)}</table>
<div class="shots">${p.shots.map((s) => `<figure><img src="${escapeHtml(s.file)}" alt="${escapeHtml(s.label)}"><figcaption>${escapeHtml(s.label)}</figcaption></figure>`).join("")}</div></section>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SKYCOT update hop check</title>
<style>
:root{--bg:#f5f5f7;--card:#fff;--fg:#1d1d1f;--mute:#6e6e73;--ok:#1d8a3a;--bad:#d70015;--line:#d2d2d7;--accent:#0071e3}
@media(prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--fg:#f5f5f7;--mute:#98989d;--ok:#32d74b;--bad:#ff453a;--line:#3a3a3c;--accent:#2997ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 20px}
h1{font-size:28px;margin:0 0 4px}h2{font-size:18px;margin:0 0 6px}
.verdict{display:inline-block;padding:4px 12px;border-radius:999px;font-weight:600;color:#fff;background:${ok ? "var(--ok)" : "var(--bad)"}}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:18px 0}
.meta{color:var(--mute);margin:0 0 10px}table{width:100%;border-collapse:collapse}
td{padding:6px 8px;border-top:1px solid var(--line);vertical-align:top}td.ok{color:var(--ok);width:24px}td.bad{color:var(--bad);width:24px}
td.n{color:var(--mute);white-space:nowrap}td.note{color:var(--mute);font-size:13px;word-break:break-word}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-top:14px}
figure{margin:0}img{width:100%;border-radius:8px;border:1px solid var(--line)}figcaption{color:var(--mute);font-size:12px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
</style></head><body><main>
<h1>Update hop check <span class="verdict">${ok ? "PASSED" : "FAILED"}</span></h1>
<p class="meta">Channel <b>${escapeHtml(r.opts.channel)}</b> &middot; previous <code>${escapeHtml(path.basename(r.opts.previous))}</code> &middot; expecting <b>${escapeHtml(r.expectedVersion ?? "?")}</b><br>${escapeHtml(r.startedAt)} &rarr; ${escapeHtml(r.finishedAt ?? "")}</p>
${ok ? "" : `<p><b>Why it failed:</b> ${escapeHtml(r.reason)}</p>`}
${sections}
</main></body></html>`;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
