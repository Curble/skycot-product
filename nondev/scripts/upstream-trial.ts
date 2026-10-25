#!/usr/bin/env node
/** A disposable upstream merge trial. It never creates a commit or changes a branch. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { findSeamsForPath, parseManifest } from "./lib.ts";

const root = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();
const home = os.homedir();
const date = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const requestedBase = option("base", "main");
const top = process.env.SKYCOT_UPSTREAM_TRIAL_HOME ?? path.join(home, "skycot-upstream-trial");
const worktree = path.join(top, "worktrees", `${date}-${process.pid}`);
const reports = path.join(top, "reports");
const results: { name: string; status: string; detail: string }[] = [];
const run = (cmd: string, args: string[], cwd = root, timeout = 10 * 60_000) => {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout,
    env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return {
    ok: r.status === 0,
    status: r.status,
    output: output.slice(-8000),
    timedOut: r.error?.code === "ETIMEDOUT",
  };
};
const base =
  requestedBase === "current" ? run("git", ["branch", "--show-current"]).output : requestedBase;
function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const html = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const step = (name: string, cmd: string, args: string[], cwd: string, timeout = 10 * 60_000) => {
  const r = run(cmd, args, cwd, timeout);
  results.push({
    name,
    status: r.ok ? "passed" : r.timedOut ? "timed out" : "failed",
    detail: r.output,
  });
  return r.ok;
};

let conflicts: { path: string; seams: string[] }[] = [];
let changed: string[] = [];
let changedSeams: { path: string; seams: string[] }[] = [];
let commits: { hash: string; subject: string }[] = [];
let securityTitles: string[] = [];
let behind = 0;
let security = false;
let verdict = "Checks failed";
let sha = "unknown";
try {
  fs.mkdirSync(reports, { recursive: true });
  const fetch = run(
    "git",
    ["fetch", "--no-tags", "upstream", "+refs/heads/main:refs/remotes/upstream/main"],
    root,
    3 * 60_000,
  );
  if (!fetch.ok) throw new Error(`Fetch failed: ${fetch.output}`);
  const target = run("git", ["rev-parse", "upstream/main"]).output;
  const baseSha = run("git", ["rev-parse", base]).output;
  sha = baseSha.slice(0, 12);
  const mb = run("git", ["merge-base", baseSha, target]).output;
  behind = Number(run("git", ["rev-list", "--count", `${baseSha}..${target}`]).output) || 0;
  const incomingLog = run("git", ["log", "--format=%H%x09%s", `${mb}..${target}`])
    .output.split("\n")
    .filter(Boolean)
    .map((l) => {
      const [hash, ...title] = l.split("\t");
      return { hash: hash!, subject: title.join("\t") };
    })
    .reverse();
  commits = incomingLog.slice(-12);
  securityTitles = incomingLog
    .filter((c) => /security|vuln|CVE/i.test(c.subject))
    .map((c) => c.subject);
  security = securityTitles.length > 0;
  changed = run("git", ["diff", "--name-only", `${mb}..${target}`])
    .output.split("\n")
    .filter(Boolean);
  const manifestPath = path.join(root, "SEAM-MANIFEST.md");
  const manifest = parseManifest(fs.readFileSync(manifestPath, "utf8"));
  changedSeams = changed.map((p) => ({
    path: p,
    seams: findSeamsForPath(manifest.seams, p).map((s) => s.id),
  }));
  const added = run("git", ["worktree", "add", "--detach", worktree, baseSha]);
  if (!added.ok) throw new Error(`Could not create trial worktree: ${added.output}`);
  const merged = run(
    "git",
    ["merge", "--no-commit", "--no-ff", "upstream/main"],
    worktree,
    3 * 60_000,
  );
  conflicts = run("git", ["diff", "--name-only", "--diff-filter=U"], worktree)
    .output.split("\n")
    .filter(Boolean)
    .map((p) => ({ path: p, seams: findSeamsForPath(manifest.seams, p).map((s) => s.id) }));
  if (!merged.ok && conflicts.length === 0)
    results.push({
      name: "Trial merge",
      status: merged.timedOut ? "timed out" : "failed",
      detail: merged.output,
    });
  if (conflicts.length) {
    results.push({
      name: "Dependency install",
      status: "skipped",
      detail: "Merge conflicts prevent a reliable install.",
    });
  } else {
    step("Install dependencies", "vp", ["install", "--frozen-lockfile"], worktree, 15 * 60_000);
  }
  step(
    "check-seams --working-tree --strict",
    "node",
    ["nondev/scripts/check-seams.ts", "--working-tree", "--strict"],
    worktree,
  );
  step("t3-address-guard", "node", ["nondev/scripts/t3-address-guard.ts"], worktree);
  if (conflicts.length)
    results.push({
      name: "SKYCOT tests and typechecks",
      status: "skipped",
      detail: "Merge conflicts are listed above; tests and typechecks were skipped.",
    });
  else {
    step(
      "SKYCOT tests",
      "vp",
      [
        "test",
        "run",
        "apps/server/src/skycot",
        "apps/nondev/src",
        "apps/skycot-mobile/src",
        "packages/skycot-rules/src",
        "packages/skycot-relay/src",
      ],
      worktree,
      15 * 60_000,
    );
    for (const pkg of ["t3", "@t3tools/nondev", "@t3tools/skycot-mobile", "@t3tools/skycot-rules"])
      step(`Typecheck ${pkg}`, "vp", ["run", "--filter", pkg, "typecheck"], worktree, 15 * 60_000);
  }
  if (conflicts.some((c) => c.seams.length === 0)) verdict = "Surprise conflicts";
  else if (conflicts.length)
    verdict = `Conflicts only in our declared seams: ${conflicts.length} files`;
  else if (results.some((r) => r.status === "failed" || r.status === "timed out"))
    verdict = "Checks failed";
  else verdict = "Clean: safe to merge";
} catch (e) {
  results.push({ name: "Trial setup", status: "failed", detail: String(e) });
} finally {
  if (fs.existsSync(worktree)) {
    run("git", ["merge", "--abort"], worktree, 30_000);
    run("git", ["worktree", "remove", "--force", worktree], root, 30_000);
  }
  run("git", ["worktree", "prune"], root, 30_000);
}
const notable = [
  ...commits.map((c) => c.subject),
  ...securityTitles.filter((s) => !commits.some((c) => c.subject === s)),
].map((subject) => `${/security|vuln|CVE/i.test(subject) ? "SECURITY — " : ""}${subject}`);
const statusLine = security ? "SECURITY" : verdict;
const rows = results
  .map(
    (r) =>
      `<li><strong>${html(r.name)}: ${html(r.status)}</strong><pre>${html(r.detail || "No output")}</pre></li>`,
  )
  .join("\n");
const conflictRows = conflicts.length
  ? conflicts
      .map(
        (c) =>
          `<li><code>${html(c.path)}</code> — ${c.seams.length ? `declared seam (${html(c.seams.join(", "))})` : "SURPRISE: no declared seam"}</li>`,
      )
      .join("\n")
  : "<li>None</li>";
const changedRows =
  changedSeams
    .map(
      (c) =>
        `<li><code>${html(c.path)}</code> — ${c.seams.length ? `declared seam (${html(c.seams.join(", "))})` : "not declared as a seam"}</li>`,
    )
    .join("\n") || "<li>None</li>";
const report = `<!doctype html><html><head><meta charset="utf-8"><title>${html(statusLine)} — SKYCOT upstream trial ${date}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#20242a}h1{color:${security ? "#a00" : "#174"}}pre{white-space:pre-wrap;background:#f3f4f6;padding:.7rem;max-height:16rem;overflow:auto}li{margin:.5rem 0}code{background:#eee}</style></head><body>${security ? "<h1>SECURITY</h1>" : ""}<h1>${html(verdict)}</h1><p><strong>Commits behind:</strong> ${behind} &nbsp; <strong>Base:</strong> ${html(base)} (${html(sha)})</p><h2>Notable upstream changes</h2><ul>${notable.map((s) => `<li>${html(s)}</li>`).join("\n") || "<li>No new commits</li>"}</ul><h2>Upstream changed files and seam status</h2><ul>${changedRows}</ul><h2>Conflicts</h2><ul>${conflictRows}</ul><h2>Checks</h2><ul>${rows}</ul><h2>What to do next</h2><p>${html(conflicts.length ? "Review the conflict files, then resolve the declared seams during the approved weekly merge. Surprise conflicts need maintainer review." : verdict === "Checks failed" ? "Review failed checks before the weekly merge." : "Review the upstream changes; the weekly merge still requires Mark’s OK. Apply any same-day security fixes promptly.")}</p><h2>Terms</h2><p><strong>Worktree</strong> means a separate checkout linked to the same Git repository.</p><p><strong>Seam</strong> means a declared SKYCOT change to an upstream-owned file.</p><p><strong>Typecheck</strong> means checking TypeScript types without building the app.</p></body></html>`;
fs.writeFileSync(path.join(reports, `${date}.html`), report);
fs.writeFileSync(
  path.join(reports, `${date}.json`),
  JSON.stringify({
    date,
    security,
    verdict,
    commitsBehind: behind,
    upstreamCommits: behind,
    changedFiles: changedSeams,
    conflicts,
    results: results.map(({ name, status }) => ({ name, status })),
  }) + "\n",
);
console.log(
  `${statusLine}: ${verdict}; ${behind} commits behind; ${conflicts.length} conflicts; report ${path.join(reports, `${date}.html`)}`,
);
