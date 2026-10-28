#!/usr/bin/env node
// One command for a Mac beta release, in the only safe order (RUNBOOK: NEVER BREAK IN-APP UPDATE):
//   build N -> upload N's files + staging-mac.yml only -> update-hop-check on the staging feed
//   -> only if it passed, upload latest-mac.yml -> print the site-bump commands.
// usage: nondev/scripts/release/release-mac.sh --version 0.1.1-nondev.37.beta --previous 0.1.1-nondev.36.beta
//          [--dry-run] [--skip-build]
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan, runPlan, siteBumpCommands } from "./release-plan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const dryRun = process.argv.includes("--dry-run");
const version = arg("--version");
const previousVersion = arg("--previous");
if (!version || !previousVersion || !/^\d+\.\d+\.\d+-nondev\.\d+\.beta$/.test(version)) {
  console.error(
    "usage: release-mac.sh --version 0.1.1-nondev.N.beta --previous 0.1.1-nondev.M.beta [--dry-run] [--skip-build]",
  );
  process.exit(2);
}
const releaseDir = process.env.SKYCOT_RELEASE_DIR ?? path.join(homedir(), "skycot-release");
const wranglerCandidates = [
  process.env.WRANGLER,
  path.join(repo, "infra/skycot-relay/node_modules/.bin/wrangler"),
  "/Users/me/skycot-wt-smoother/infra/skycot-relay/node_modules/.bin/wrangler",
].filter(Boolean);
const wrangler =
  wranglerCandidates.find((p) => existsSync(p)) ?? wranglerCandidates[0] ?? "wrangler";
const config = {
  version,
  previousVersion,
  repo,
  releaseDir,
  wrangler,
  relayDir: path.join(repo, "infra/skycot-relay"),
  hopOut: path.join(releaseDir, version, "hop-report"),
  skipBuild: process.argv.includes("--skip-build"),
};

const show = (c) =>
  c.verifyUrl
    ? `curl -sI ${c.verifyUrl}${c.expectVersion ? `   # must show ${c.expectVersion}` : "   # must be 200"}`
    : `${Object.entries(c.env ?? {})
        .map(([k, v]) => `${k}='${v}' `)
        .join(
          "",
        )}${c.file} ${c.args.map((a) => (/[\s;]/.test(a) ? `"${a}"` : a)).join(" ")}   (in ${c.cwd})`;

function runCommand(c) {
  return new Promise((resolve) => {
    const child = spawn(c.file, c.args, {
      cwd: c.cwd,
      env: { ...process.env, ...(c.env ?? {}) },
      stdio: "inherit",
    });
    child.on("error", (e) =>
      resolve({ ok: false, detail: `could not start ${c.file}: ${e.message}` }),
    );
    child.on("exit", (code) =>
      resolve({ ok: code === 0, detail: `${path.basename(c.file)} exited with code ${code}` }),
    );
  });
}

async function exec(c, { dryRun: dry }) {
  if (dry) {
    console.log(`   [dry run] ${show(c)}`);
    return { ok: true };
  }
  if (c.verifyUrl) {
    const res = await fetch(c.verifyUrl, { headers: { "cache-control": "no-cache" } });
    if (!res.ok) return { ok: false, detail: `${c.verifyUrl} answered ${res.status}` };
    if (c.expectVersion) {
      const body = await res.text();
      if (!new RegExp(`^version:\\s*${c.expectVersion.replace(/\./g, "\\.")}\\s*$`, "m").test(body))
        return { ok: false, detail: `${c.verifyUrl} does not show version ${c.expectVersion}` };
    }
    return { ok: true };
  }
  return runCommand(c);
}

if (
  !dryRun &&
  !existsSync(path.join(releaseDir, previousVersion, `SKYCOT-${previousVersion}-arm64.dmg`))
) {
  console.error(
    `The previous release's dmg is missing: ${path.join(releaseDir, previousVersion)}. The hop gate cannot run without it.`,
  );
  process.exit(2);
}
console.log(
  `Release ${version} (previous ${previousVersion})${dryRun ? " -- DRY RUN, nothing is run or uploaded" : ""}`,
);
const result = await runPlan(buildPlan(config), exec, { dryRun, log: (m) => console.log(m) });
if (!result.ok) {
  console.error(
    `\n${result.message}\nFix the cause and run again (uploads of the same files are safe to repeat).`,
  );
  process.exit(1);
}
console.log(
  `\n${dryRun ? "Dry run complete." : `${version} is live on the feed and passed the update hop.`}\nNext, the website:`,
);
for (const l of siteBumpCommands(config)) console.log(`  ${l}`);
