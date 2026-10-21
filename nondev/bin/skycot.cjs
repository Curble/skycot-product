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
const NodePath = require("node:path");
const NodeFS = require("node:fs");
const NodeURL = require("node:url");

const bin = NodePath.join(__dirname, "../../apps/server/dist/bin.mjs");
if (!NodeFS.existsSync(bin)) {
  process.stderr.write(
    `skycot: ${bin} is missing. Build the server first: vp run --filter t3 build\n`,
  );
  process.exit(2);
}
import(NodeURL.pathToFileURL(bin).href).catch((error) => {
  process.stderr.write(
    `skycot: failed to start the server: ${error && error.stack ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
