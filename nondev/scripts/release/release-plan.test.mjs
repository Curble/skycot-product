// Run with: node --test nondev/scripts/release/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlan, runPlan } from "./release-plan.mjs";
import { bundleProcesses, mainProcess, parseArgs, parseFeedVersion } from "./update-hop-check.mjs";

const cfg = {
  version: "0.1.1-nondev.37.beta",
  previousVersion: "0.1.1-nondev.36.beta",
  repo: "/repo",
  releaseDir: "/rel",
  wrangler: "/w",
  relayDir: "/repo/infra/skycot-relay",
  hopOut: "/rel/hop",
};

/** Fake executor: records every command, fails the ones `failOn` matches. */
function fake(failOn = () => false) {
  const calls = [];
  const exec = async (c) => {
    calls.push(c);
    return failOn(c) ? { ok: false, detail: "fake failure" } : { ok: true };
  };
  return { calls, exec };
}
const label = (c) =>
  c.verifyUrl
    ? `verify:${c.verifyUrl.split("/").pop()}`
    : (c.args.find((a) => a.startsWith("skycot-downloads/mac/")) ?? "other").split("/").pop();
const isHop = (c) => c.args?.some((a) => a.endsWith("update-hop-check.mjs"));
const isLatestPut = (c) => c.args?.includes("skycot-downloads/mac/latest-mac.yml");

test("happy path: build, files, staging feed, hop, then latest-mac.yml LAST", async () => {
  const { calls, exec } = fake();
  const r = await runPlan(buildPlan(cfg), exec);
  assert.equal(r.ok, true);
  const names = calls.map(label);
  assert.equal(names[0], "other"); // the build
  assert.ok(
    names.indexOf("staging-mac.yml") > names.indexOf("SKYCOT-0.1.1-nondev.37.beta-arm64.dmg"),
  );
  assert.ok(calls.findIndex(isHop) > names.indexOf("staging-mac.yml"));
  const latest = calls.findIndex(isLatestPut);
  assert.ok(latest > calls.findIndex(isHop));
  assert.equal(calls.filter(isLatestPut).length, 1);
  // The zip/dmg are uploaded before any feed file, and latest is the last thing that is uploaded.
  const puts = calls.filter((c) => c.args?.includes("put"));
  assert.ok(isLatestPut(puts.at(-1)));
});

test("a failed hop never uploads latest-mac.yml", async () => {
  const { calls, exec } = fake(isHop);
  const r = await runPlan(buildPlan(cfg), exec);
  assert.equal(r.ok, false);
  assert.equal(r.failedStep, "hop");
  assert.match(r.message, /latest-mac\.yml was NOT uploaded/);
  assert.equal(calls.filter(isLatestPut).length, 0);
});

test("every failing step stops the run and nothing after it runs", async () => {
  const steps = buildPlan(cfg);
  const total = await (async () => {
    const f = fake();
    await runPlan(steps, f.exec);
    return f.calls.length;
  })();
  const latestAt = await (async () => {
    const f = fake();
    await runPlan(steps, f.exec);
    return f.calls.findIndex(isLatestPut);
  })();
  for (let n = 0; n < total; n += 1) {
    let i = -1;
    const { calls, exec } = fake(() => ++i === n);
    const r = await runPlan(steps, exec);
    assert.equal(r.ok, false, `failing command ${n}`);
    assert.equal(calls.length, n + 1, `nothing runs after failing command ${n}`);
    if (n <= latestAt)
      assert.equal(calls.filter(isLatestPut).length, n === latestAt ? 1 : 0, `command ${n}`);
    if (n < latestAt)
      assert.equal(
        calls.filter(isLatestPut).length,
        0,
        `latest never uploaded when command ${n} fails`,
      );
  }
});

test("latest-mac.yml cannot be reached when the hop step is removed from the plan", async () => {
  const steps = buildPlan(cfg).filter((s) => s.id !== "hop");
  const { calls, exec } = fake();
  const r = await runPlan(steps, exec);
  assert.equal(r.ok, false);
  assert.equal(r.failedStep, "upload-latest");
  assert.equal(calls.filter(isLatestPut).length, 0);
});

test("a thrown error from a command is a failure, not a crash", async () => {
  const r = await runPlan(buildPlan(cfg), async () => {
    throw new Error("boom");
  });
  assert.equal(r.ok, false);
  assert.match(r.message, /boom/);
});

test("--skip-build drops only the build step", () => {
  assert.deepEqual(
    buildPlan({ ...cfg, skipBuild: true }).map((s) => s.id),
    ["upload-files", "upload-staging", "hop", "upload-latest"],
  );
  assert.deepEqual(
    buildPlan(cfg).map((s) => s.id),
    ["build", "upload-files", "upload-staging", "hop", "upload-latest"],
  );
});

test("the hop runs on the staging feed against the previous release's dmg", () => {
  const hop = buildPlan(cfg).find((s) => s.id === "hop").commands[0];
  assert.ok(hop.args.includes("staging"));
  assert.ok(hop.args.includes("/rel/0.1.1-nondev.36.beta/SKYCOT-0.1.1-nondev.36.beta-arm64.dmg"));
});

test("hop-check helpers", () => {
  assert.equal(parseFeedVersion("version: 0.1.1-nondev.36.beta\nfiles:\n"), "0.1.1-nondev.36.beta");
  assert.equal(parseFeedVersion("nothing"), null);
  const o = parseArgs(["--previous", "/a.dmg", "--channel", "staging", "--out", "/o"]);
  assert.deepEqual(o.paths, ["header", "code"]);
  assert.throws(
    () => parseArgs(["--previous", "/a", "--channel", "nightly", "--out", "/o"]),
    /latest or staging/,
  );
  const ps = ` 10 1 /Users/me/Applications/SKYCOT.app/Contents/MacOS/SKYCOT --use-mock-keychain\n 11 10 /Users/me/Applications/SKYCOT.app/Contents/Frameworks/H --type=gpu\n 12 1 /Applications/SKYCOT.app/Contents/MacOS/SKYCOT\n`;
  const procs = bundleProcesses(ps, "/Users/me/Applications/SKYCOT.app");
  assert.deepEqual(
    procs.map((p) => p.pid),
    [10, 11],
  );
  assert.equal(mainProcess(procs).pid, 10);
});
