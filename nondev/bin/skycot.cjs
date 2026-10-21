#!/usr/bin/env node
"use strict";
/**
 * The only supported way to start the SKYCOT server from a source checkout or an unpacked
 * `apps/server/dist` build. It loads the brand bootstrap (state directory `~/.skycot`, analytics
 * off and pointed at a loopback sink, SKYCOT deep-link scheme, `/simple/` pairing URL, SKYCOT
 * release feed) before a single upstream module evaluates, then hands over to upstream's CLI.
 *
 *   node nondev/bin/skycot.cjs serve
 *   node nondev/bin/skycot.cjs pair
 *
 * `node apps/server/dist/bin.mjs` without this wrapper still cannot report to upstream's PostHog
 * project (apps/server/src/telemetry/AnalyticsService.ts, seam telemetry-default-off) but would
 * use upstream's `~/.t3` state directory and `t3code://` scheme.
 */
require("../brand/env.cjs");
const NodeChildProcess = require("node:child_process");
const NodePath = require("node:path");
const NodeFS = require("node:fs");

const bin = NodePath.join(__dirname, "../../apps/server/dist/bin.mjs");
if (!NodeFS.existsSync(bin)) {
  process.stderr.write(
    `skycot: ${bin} is missing. Build the server first: vp run --filter t3 build\n`,
  );
  process.exit(2);
}

// bin.mjs only runs its CLI when it is the process entry point (`import.meta.main`); a dynamic
// import() from here loads every module and exits 0 without output. So re-exec Node on it. The
// child inherits process.env, which env.cjs has already branded.
const child = NodeChildProcess.spawn(process.execPath, [bin, ...process.argv.slice(2)], {
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  });
}
child.on("error", (error) => {
  process.stderr.write(`skycot: failed to start the server: ${error.message}\n`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
