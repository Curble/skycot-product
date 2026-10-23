#!/usr/bin/env node
// Starts a local relay and a local engine in fresh folders, runs family-relay-e2e.ts against them
// and stops both again (by the process ids it started). Nothing touches the real SKYCOT data,
// the user's home folder or any AI service: the engine runs with its own HOME and a PATH that
// holds only node, git and a pretend `claude` (fake-claude.mjs).
//
//   node e2e/run-family-e2e.ts <work folder>
//
// Ports: the relay on E2E_RELAY_PORT (8811), the engine on E2E_ENGINE_PORT (8812).

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const repo = NodePath.resolve(here, "../../..");
const work = NodePath.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: node e2e/run-family-e2e.ts <work folder>");
const relayPort = Number(process.env.E2E_RELAY_PORT ?? 8811);
const enginePort = Number(process.env.E2E_ENGINE_PORT ?? 8812);
const playwright =
  process.env.E2E_PLAYWRIGHT ??
  NodePath.join(repo, "node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core");

const run = NodePath.join(work, `run-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`);
const dirs = {
  bin: NodePath.join(run, "bin"),
  home: NodePath.join(run, "home"),
  engine: NodePath.join(run, "engine-home"),
  relayState: NodePath.join(run, "relay-state"),
  app: NodePath.join(run, "app"),
  out: NodePath.join(work, "screenshots"),
  tmp: NodePath.join(run, "tmp"),
};
for (const dir of Object.values(dirs)) NodeFS.mkdirSync(dir, { recursive: true });

// The hosted client a phone opens: the plain client's build, as SKYCOT's web address would serve it.
const nondevDist = NodePath.join(repo, "apps/nondev/dist");
if (!NodeFS.existsSync(NodePath.join(nondevDist, "index.html"))) {
  throw new Error("Build the plain client first: (cd apps/nondev && vp build)");
}
NodeFS.cpSync(nondevDist, NodePath.join(dirs.app, "simple"), { recursive: true });
const engineBin = NodePath.join(repo, "apps/server/dist/bin.mjs");
if (!NodeFS.existsSync(NodePath.join(repo, "apps/server/dist/client/simple/index.html"))) {
  throw new Error("Bundle the engine with the plain client first (see docs/nondev/RELAY.md).");
}

NodeFS.symlinkSync(process.execPath, NodePath.join(dirs.bin, "node"));
NodeFS.symlinkSync("/usr/bin/git", NodePath.join(dirs.bin, "git"));
const claude = NodePath.join(dirs.bin, "claude");
NodeFS.writeFileSync(
  claude,
  `#!/bin/sh\nexec "${process.execPath}" "${NodePath.join(here, "fake-claude.mjs")}" "$@"\n`,
  { mode: 0o755 },
);

// Only the pretend Claude is switched on; every other assistant is off before the first start.
const off = (driver: string) => ({ driver, enabled: false });
NodeFS.mkdirSync(NodePath.join(dirs.engine, "userdata"), { recursive: true });
NodeFS.writeFileSync(
  NodePath.join(dirs.engine, "userdata/settings.json"),
  JSON.stringify(
    {
      providerInstances: {
        codex: off("codex"),
        cursor: off("cursor"),
        grok: off("grok"),
        muse: off("muse"),
        pi: off("pi"),
        opencode: off("opencode"),
        antigravity: off("antigravity"),
        claudeAgent: { driver: "claudeAgent", enabled: true, config: { binaryPath: claude } },
      },
    },
    null,
    2,
  ),
);

const started: Array<NodeChildProcess.ChildProcess> = [];
function start(
  name: string,
  command: string,
  args: ReadonlyArray<string>,
  options: NodeChildProcess.SpawnOptions,
) {
  const logPath = NodePath.join(run, `${name}.log`);
  const out = NodeFS.openSync(logPath, "a");
  const child = NodeChildProcess.spawn(command, args, { ...options, stdio: ["ignore", out, out] });
  started.push(child);
  console.log(`started ${name} (pid ${child.pid}), log ${logPath}`);
  return { child, logPath };
}

async function waitFor(what: string, probe: () => boolean | Promise<boolean>, tries = 120) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const stopAll = async () => {
  for (const child of started.reverse()) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  await Promise.all(
    started.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve();
          child.once("exit", () => resolve());
          setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
            resolve();
          }, 10_000);
        }),
    ),
  );
};

// A pretend Apple push service on this Mac: it records what the relay would have sent to Apple.
const apnsPort = Number(process.env.E2E_APNS_PORT ?? 8813);
const pushes: Array<{ path: string; headers: Record<string, unknown>; body: string }> = [];
const apns = NodeHttp.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    pushes.push({ path: request.url ?? "", headers: request.headers, body });
    NodeFS.writeFileSync(NodePath.join(run, "apns-received.json"), JSON.stringify(pushes, null, 2));
    response.statusCode = 200;
    response.end();
  });
});
await new Promise<void>((resolve) => apns.listen(apnsPort, "127.0.0.1", resolve));
// A throwaway signing key standing in for Curble's APNs key (never a real one).
const apnsKey = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
])) as CryptoKeyPair;
const apnsPem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey("pkcs8", apnsKey.privateKey)).toString("base64")}\n-----END PRIVATE KEY-----`;
const pushRefKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

let exitCode = 1;
try {
  const relay = start(
    "relay",
    NodePath.join(here, "../node_modules/.bin/wrangler"),
    [
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(relayPort),
      "--persist-to",
      dirs.relayState,
      "--assets",
      dirs.app,
      "--var",
      "RELAY_DEBUG_FRAMES:1",
      "--var",
      `APNS_ORIGIN:http://127.0.0.1:${apnsPort}`,
      "--var",
      "APNS_TEAM_ID:TEAMTEST01",
      "--var",
      "APNS_KEY_ID:KEYTEST001",
      "--var",
      "APNS_BUNDLE_ID:com.skycot.test",
      "--var",
      `APNS_PRIVATE_KEY:${apnsPem}`,
      "--var",
      `PUSH_REF_KEY:${pushRefKey}`,
    ],
    { cwd: NodePath.join(here, ".."), env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
  );
  await waitFor("the relay", async () => {
    try {
      return (await fetch(`http://127.0.0.1:${relayPort}/health`)).ok;
    } catch {
      return false;
    }
  });

  const engine = start(
    "engine",
    NodePath.join(dirs.bin, "node"),
    [
      "--import",
      "./nondev/brand/env.cjs",
      engineBin,
      "serve",
      "--port",
      String(enginePort),
      "--host",
      "127.0.0.1",
      "--base-dir",
      dirs.engine,
    ],
    {
      cwd: repo,
      env: {
        HOME: dirs.home,
        PATH: `${dirs.bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
        TMPDIR: dirs.tmp,
        T3CODE_HOME: dirs.engine,
        SKYCOT_RELAY_URL: `http://127.0.0.1:${relayPort}`,
        FAKE_CLAUDE_LOG: NodePath.join(run, "fake-claude.log"),
      },
    },
  );
  let pairingUrl = "";
  await waitFor("the engine's pairing link", () => {
    const match = /Pairing URL: (\S+)/.exec(NodeFS.readFileSync(engine.logPath, "utf8"));
    pairingUrl = match?.[1] ?? "";
    return pairingUrl !== "";
  });

  const driver = NodeChildProcess.spawn(
    process.execPath,
    [NodePath.join(here, "family-relay-e2e.ts")],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        E2E_PAIRING_URL: pairingUrl,
        E2E_RELAY_LOG: relay.logPath,
        E2E_ENGINE_LOG: engine.logPath,
        E2E_OUT: dirs.out,
        E2E_PLAYWRIGHT: playwright,
        E2E_APNS_LOG: NodePath.join(run, "apns-received.json"),
      },
    },
  );
  // Not spawnSync: the pretend Apple service above must keep answering while the test runs.
  exitCode = await new Promise<number>((resolve) =>
    driver.once("exit", (code) => resolve(code ?? 1)),
  );
} finally {
  await stopAll();
  await new Promise<void>((resolve) => apns.close(() => resolve()));
  console.log(`stopped ${started.length} processes; work folder ${run}`);
}
process.exit(exitCode);
