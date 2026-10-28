// The safe order of a Mac release, as data, plus the runner that walks it. Kept free of side effects
// (every real command goes through the injected `exec`) so release-plan.test.mjs can drive it with
// fake steps. The rule it enforces: nothing marked `needs: ["hop"]` (the upload of latest-mac.yml)
// may run unless the update-hop step ran and passed in this same run.
import path from "node:path";

export const FEED_BUCKET_PATH = "skycot-downloads/mac";

/**
 * @param {{version:string, previousVersion:string, repo:string, releaseDir:string, wrangler:string,
 *          relayDir:string, hopOut:string, skipBuild?:boolean}} c
 */
export function buildPlan(c) {
  const v = c.version;
  const dir = path.join(c.releaseDir, v);
  const file = (n) => path.join(dir, n);
  const arm = (ext) => `SKYCOT-${v}-arm64.${ext}`;
  const put = (name, source, type, cache) => ({
    file: c.wrangler,
    args: [
      "r2",
      "object",
      "put",
      `${FEED_BUCKET_PATH}/${name}`,
      "--file",
      source,
      "--content-type",
      type,
      "--cache-control",
      cache,
      "--remote",
    ],
    cwd: c.relayDir,
  });
  const immutable = "public, max-age=31536000, immutable";
  const steps = [];
  if (!c.skipBuild) {
    steps.push({
      id: "build",
      title: `Build and notarise ${v}`,
      commands: [
        {
          file: "node",
          args: [
            "--import",
            "./nondev/brand/env.cjs",
            "scripts/build-desktop-artifact.ts",
            "--platform",
            "mac",
            "--target",
            "dmg",
            "--arch",
            "arm64",
            "--signed",
            "--build-version",
            v,
            "--output-dir",
            dir,
          ],
          cwd: c.repo,
          env: { CSC_NAME: "Mark Hallam (3F72LCWGG2)", APPLE_KEYCHAIN_PROFILE: "skycot-notary" },
        },
      ],
    });
  }
  steps.push(
    {
      id: "upload-files",
      title: `Upload ${v}'s zip, blockmaps and dmg (no feed file yet)`,
      commands: [
        put(arm("zip"), file(arm("zip")), "application/zip", immutable),
        put(arm("zip.blockmap"), file(arm("zip.blockmap")), "application/octet-stream", immutable),
        put(arm("dmg.blockmap"), file(arm("dmg.blockmap")), "application/octet-stream", immutable),
        put(arm("dmg"), file(arm("dmg")), "application/x-apple-diskimage", immutable),
        { verifyUrl: `https://downloads.skycot.com/mac/${arm("zip")}` },
        { verifyUrl: `https://downloads.skycot.com/mac/${arm("dmg")}` },
      ],
    },
    {
      id: "upload-staging",
      title: "Upload staging-mac.yml (only the staging feed; real apps never read it)",
      commands: [
        put("staging-mac.yml", file("latest-mac.yml"), "text/yaml; charset=utf-8", "no-cache"),
      ],
    },
    {
      id: "hop",
      title: `Prove the ${c.previousVersion} -> ${v} update hop on a packaged app (staging feed)`,
      commands: [
        {
          file: "node",
          args: [
            path.join(c.repo, "nondev/scripts/release/update-hop-check.mjs"),
            "--previous",
            path.join(c.releaseDir, c.previousVersion, `SKYCOT-${c.previousVersion}-arm64.dmg`),
            "--channel",
            "staging",
            "--expect-version",
            v,
            "--out",
            c.hopOut,
          ],
          cwd: c.repo,
        },
      ],
    },
    {
      id: "upload-latest",
      title: "Switch the live feed: upload latest-mac.yml LAST with no-cache",
      needs: ["hop"],
      commands: [
        put("latest-mac.yml", file("latest-mac.yml"), "text/yaml; charset=utf-8", "no-cache"),
        { verifyUrl: "https://downloads.skycot.com/mac/latest-mac.yml", expectVersion: v },
      ],
    },
  );
  return steps;
}

/** What to do for the website once the feed is live. Printed, never run. */
export function siteBumpCommands(c) {
  const site = "/Users/me/skycot-site-product";
  const beta = (v) => (/-nondev\.(\d+)\.beta$/.exec(v) ?? [])[1] ?? v;
  return [
    `cd ${c.repo}`,
    `# 1. bump the version in the site sources (three files), then build the draft:`,
    `sed -i '' 's/nondev\\.${beta(c.previousVersion)}\\.beta/nondev.${beta(c.version)}.beta/g' docs/skycot-site/build_site.py docs/skycot-site/home.html ${site}/scripts/verify-site.mjs`,
    `(cd docs/skycot-site && python3 build_site.py)`,
    `# 2. copy the draft into the site repo (never --delete) and build outside iCloud:`,
    `rsync -a docs/skycot-site/draft/ ${site}/public/`,
    `OUT=$(cd ${site} && sh scripts/build-outside-icloud.sh)`,
    `# 3. preview, verify, then production, verify:`,
    `(cd "$OUT/.." && npx wrangler@latest pages deploy out --project-name skycot-site --branch product-site)`,
    `(cd ${site} && node scripts/verify-site.mjs https://<preview id>.skycot-site.pages.dev)`,
    `(cd "$OUT/.." && npx wrangler@latest pages deploy out --project-name skycot-site --branch main)`,
    `(cd ${site} && CHECK_REDIRECTS=1 node scripts/verify-site.mjs https://skycot.com)`,
    `# 4. record it: ${site}/DEPLOYMENT.md (deploy id + rollback id), commit both repos, tag v${c.version} and push`,
  ];
}

/**
 * Walk the plan. `exec(command, {dryRun})` returns {ok, detail}. Stops at the first failure and says
 * which step, in plain English; never runs a step whose `needs` did not pass in this run.
 */
export async function runPlan(steps, exec, { dryRun = false, log = () => {} } = {}) {
  const passed = new Set();
  const ran = [];
  for (const step of steps) {
    const missing = (step.needs ?? []).filter((n) => !passed.has(n));
    if (missing.length > 0) {
      const message = `BLOCKED at "${step.title}": the ${missing.join(", ")} step has not passed in this run, so latest-mac.yml was NOT uploaded.`;
      log(message);
      return { ok: false, failedStep: step.id, message, ran };
    }
    log(`== ${step.title}`);
    for (const command of step.commands) {
      let result;
      try {
        result = await exec(command, { dryRun, step });
      } catch (e) {
        result = { ok: false, detail: String(e && e.message ? e.message : e) };
      }
      ran.push({ step: step.id, command });
      if (!result.ok) {
        const message = `STOPPED at "${step.title}": ${result.detail || "the command failed"}. ${
          steps.some((s) => s.id === "upload-latest") && !passed.has("upload-latest")
            ? "latest-mac.yml was NOT uploaded, so no real app was offered this release."
            : ""
        }`.trim();
        log(message);
        return { ok: false, failedStep: step.id, message, ran };
      }
    }
    passed.add(step.id);
  }
  return { ok: true, failedStep: null, message: "", ran };
}
