#!/usr/bin/env node
/**
 * upstream-sync — merges upstream T3 Code (pingdotgg/t3code) into this fork on a dated branch.
 *
 *   node nondev/scripts/upstream-sync.ts [--dry-run] [--no-verify] [--branch <name>]
 *                                        [--upstream-ref main] [--base-branch main]
 *                                        [--report nondev/sync-report.md] [--outputs <file>]
 *
 * Rules (decided, see nondev/README.md):
 *  - merge, never rebase; `main` is never touched directly (work happens on sync/upstream-YYYY-MM-DD)
 *  - git rerere is enabled so a conflict resolved once is resolved the same way next time
 *  - pnpm-lock.yaml conflict  -> take upstream's file, re-resolve with `vp install --lockfile-only`
 *  - conflict in a declared seam (SEAM-MANIFEST.md) -> take upstream's file, report "seam needs re-apply"
 *  - conflict in a path we own (apps/nondev/**, nondev/**, ...) -> keep ours, report the collision
 *  - any other conflict -> abort the merge, delete the branch, report, exit 2
 *  - then (unless --no-verify): vp install, typecheck + build of @t3tools/nondev, export-drift report
 *  - always writes nondev/sync-report.md (committed on the sync branch) and GITHUB_OUTPUT lines
 *
 * Exit codes: 0 merged and green (or nothing to merge) · 1 merged but needs a human
 * (seam re-apply, lockfile re-resolution failure, typecheck/build failure) · 2 aborted or refused.
 *
 * --dry-run fetches and reports only: no branch, no merge, no files written (report to stdout).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  branchExists,
  currentBranch,
  dirtyFiles,
  git,
  gitLines,
  gitTry,
  hasRemote,
  loadEngineSnapshot,
  nearestTag,
  packageVersionAt,
  repoRoot,
  run,
  scanOurImports,
} from "./git.ts";
import {
  ENGINE_PACKAGES,
  MANIFEST_PATH,
  OUR_CLIENT_SRC,
  type Seam,
  diffExports,
  findSeamsForPath,
  formatOutputs,
  isOurPath,
  parseConflictPaths,
  parseManifest,
  renderExportDiff,
  tail,
  todayIso,
} from "./lib.ts";

const UPSTREAM_URL = "https://github.com/pingdotgg/t3code.git";
const OUR_PACKAGE = "@t3tools/nondev";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--")
    ? process.argv[i + 1]!
    : fallback;
}

type Status = "up-to-date" | "clean" | "needs-human" | "aborted";

interface Conflict {
  path: string;
  kind: "lockfile" | "seam" | "ours" | "unexpected";
  resolution: string;
  seams?: Seam[];
}

interface StepResult {
  name: string;
  ok: boolean;
  skipped?: boolean;
  log: string;
}

class Report {
  readonly lines: string[] = [];
  push(...l: string[]): void {
    this.lines.push(...l);
  }
  toString(): string {
    return `${this.lines.join("\n")}\n`;
  }
}

function fail(message: string, code = 2): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(code);
}

function runTool(root: string, name: string, cmd: string, args: string[]): StepResult {
  console.log(`\n▶ ${name}: ${cmd} ${args.join(" ")}`);
  const r = run(cmd, args, {
    cwd: root,
    env: { ...process.env, CI: process.env.CI ?? "1", FORCE_COLOR: "0" },
  });
  console.log(tail(r.out, 20, 2000));
  console.log(r.ok ? `✔ ${name} passed` : `✖ ${name} failed (exit ${r.status})`);
  return { name, ok: r.ok, log: r.out };
}

/** `vp` when available, else `pnpm`; both accept the same install flags. */
function packageManager(root: string): string {
  return run("vp", ["--version"], { cwd: root }).ok ? "vp" : "pnpm";
}

/** Resolve a conflicted path in favour of one side, coping with delete/modify conflicts. */
function takeSide(root: string, path: string, side: "ours" | "theirs"): string {
  const stages = gitLines(root, ["ls-files", "-u", "--", path]).map((l) => l.split(/\s+/)[2]);
  const wantStage = side === "ours" ? "2" : "3";
  if (!stages.includes(wantStage)) {
    // That side deleted the file.
    git(root, ["rm", "-q", "--cached", "--", path]);
    NodeFS.rmSync(NodePath.join(root, path), { force: true });
    return `deleted (${side} side removed it)`;
  }
  git(root, ["checkout", `--${side}`, "--", path]);
  git(root, ["add", "--", path]);
  return `took ${side}`;
}

function main(): void {
  const dryRun = flag("dry-run");
  const verify = !flag("no-verify");
  const upstreamRef = option("upstream-ref", "main");
  const baseBranch = option("base-branch", "main");
  const date = todayIso();
  const branch = option("branch", `sync/upstream-${date}`);
  const reportPath = option("report", "nondev/sync-report.md");
  const outputsPath = process.argv.includes("--outputs")
    ? option("outputs", "")
    : (process.env.GITHUB_OUTPUT ?? "");

  const root = repoRoot();
  const report = new Report();
  const outputs: Record<string, string | number | boolean> = { branch, date, status: "aborted" };
  const finish = (status: Status, code: number): never => {
    outputs.status = status;
    if (outputsPath) {
      try {
        NodeFS.appendFileSync(outputsPath, formatOutputs(outputs));
      } catch (e) {
        console.error(`could not write outputs to ${outputsPath}: ${(e as Error).message}`);
      }
    }
    process.exit(code);
  };
  if (!hasRemote(root, "upstream")) {
    if (dryRun)
      fail(`No \`upstream\` remote. Add it with:\n  git remote add upstream ${UPSTREAM_URL}`);
    console.log(`Adding missing upstream remote ${UPSTREAM_URL}`);
    git(root, ["remote", "add", "upstream", UPSTREAM_URL]);
  }
  const dirty = dirtyFiles(root);
  if (!dryRun && (dirty.tracked.length > 0 || dirty.untracked.length > 0)) {
    const list = [...dirty.tracked, ...dirty.untracked]
      .slice(0, 15)
      .map((p) => `  - ${p}`)
      .join("\n");
    fail(
      `Your working copy has uncommitted changes, so the merge cannot start safely.\n` +
        `Commit or discard these first (a sync must begin from a clean, committed state):\n${list}` +
        (dirty.tracked.length + dirty.untracked.length > 15 ? "\n  - …" : ""),
    );
  }
  if (!dryRun && gitTry(root, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]) !== null) {
    fail(
      "A merge is already in progress (MERGE_HEAD exists). Finish or abort it (`git merge --abort`) first.",
    );
  }
  if (
    !dryRun &&
    gitTry(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${baseBranch}`]) === null
  ) {
    fail(`Base branch \`${baseBranch}\` does not exist locally.`);
  }
  console.log(`Fetching upstream/${upstreamRef} …`);
  const fetched = run(
    "git",
    [
      "fetch",
      "--no-tags",
      "upstream",
      `+refs/heads/${upstreamRef}:refs/remotes/upstream/${upstreamRef}`,
    ],
    { cwd: root },
  );
  if (!fetched.ok) fail(`git fetch upstream failed:\n${fetched.out}`);
  run("git", ["fetch", "--tags", "upstream"], { cwd: root }); // best effort; tags only feed the report

  const target = git(root, ["rev-parse", `refs/remotes/upstream/${upstreamRef}`]);
  const baseTip = dryRun ? git(root, ["rev-parse", "HEAD"]) : git(root, ["rev-parse", baseBranch]);
  const mergeBase = git(root, ["merge-base", baseTip, target]);
  const commits = Number(git(root, ["rev-list", "--count", `${mergeBase}..${target}`]));
  const ourTail = Number(
    git(root, ["rev-list", "--count", "--first-parent", `${mergeBase}..${baseTip}`]),
  );
  const versionFrom = packageVersionAt(root, mergeBase) ?? "?";
  const versionTo = packageVersionAt(root, target) ?? "?";
  const tagFrom = nearestTag(root, mergeBase) ?? "(no tag)";
  const tagTo = nearestTag(root, target) ?? "(no tag)";
  Object.assign(outputs, {
    upstream_old: mergeBase,
    upstream_new: target,
    upstream_new_short: target.slice(0, 10),
    commits,
    version_from: versionFrom,
    version_to: versionTo,
  });

  const manifestFile = NodePath.join(root, MANIFEST_PATH);
  const manifest = NodeFS.existsSync(manifestFile)
    ? parseManifest(NodeFS.readFileSync(manifestFile, "utf8"))
    : { seams: [], warnings: [`${MANIFEST_PATH} not found; no seams declared.`] };
  const upstreamChanged = gitLines(root, ["diff", "--name-only", `${mergeBase}..${target}`]);
  const seamFilesTouched = upstreamChanged.filter(
    (p) => findSeamsForPath(manifest.seams, p).length > 0,
  );
  const ourPathsTouched = upstreamChanged.filter((p) => isOurPath(p));

  report.push(
    `# Upstream sync ${date}${dryRun ? " (dry run)" : ""}`,
    "",
    `| | |`,
    `|---|---|`,
    `| Branch | \`${branch}\` |`,
    `| Upstream commits merged | **${commits}** |`,
    `| Upstream moved | \`${mergeBase.slice(0, 10)}\` → \`${target.slice(0, 10)}\` |`,
    `| Upstream version (apps/desktop/package.json) | ${versionFrom} → ${versionTo} |`,
    `| Nearest upstream tag | ${tagFrom} → ${tagTo} |`,
    `| Our commits on top of upstream (before this sync) | ${ourTail} |`,
    `| Seams declared in ${MANIFEST_PATH} | ${manifest.seams.length} |`,
    "",
  );
  for (const w of manifest.warnings) report.push(`> ⚠ ${w}`);

  if (commits === 0) {
    report.push("", "**Nothing to merge** — `main` already contains everything on upstream/main.");
    console.log(report.toString());
    // Nothing was branched, so write nothing into the working tree: `main` must stay clean.
    if (process.env.GITHUB_STEP_SUMMARY)
      NodeFS.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.toString());
    finish("up-to-date", 0);
  }

  // Changed-area summary
  const byTop = new Map<string, number>();
  for (const p of upstreamChanged) {
    const parts = p.split("/");
    const key =
      parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts.length === 2 ? parts[0]! : "(root)";
    byTop.set(key, (byTop.get(key) ?? 0) + 1);
  }
  report.push("", `## What upstream changed (${upstreamChanged.length} files)`, "");
  for (const [k, n] of [...byTop].sort((a, b) => b[1] - a[1]).slice(0, 15))
    report.push(`- \`${k}\`: ${n} file${n === 1 ? "" : "s"}`);

  report.push("", "## Seam files upstream touched in this window", "");
  if (seamFilesTouched.length === 0)
    report.push(
      "None — no declared seam file changed upstream, so no seam conflicts are expected.",
    );
  for (const p of seamFilesTouched) {
    const seams = findSeamsForPath(manifest.seams, p)
      .map((s) => `\`${s.id}\``)
      .join(", ");
    const log = gitLines(root, ["log", "--format=%h %s", `${mergeBase}..${target}`, "--", p]).slice(
      0,
      5,
    );
    report.push(
      `- \`${p}\` (seam ${seams}) — ${log.length} upstream commit(s): ${log.map((l) => `\`${l}\``).join("; ")}`,
    );
  }
  if (ourPathsTouched.length) {
    report.push(
      "",
      "> ⚠ Upstream created or changed files inside paths this fork owns:",
      ...ourPathsTouched.map((p) => `> - \`${p}\``),
    );
  }
  const engineCommits = gitLines(root, [
    "log",
    "--format=- %h %s",
    `${mergeBase}..${target}`,
    "--",
    ...ENGINE_PACKAGES.map((p) => p.dir),
  ]);
  report.push("", `## Upstream commits touching engine packages (${engineCommits.length})`, "");
  report.push(...(engineCommits.length ? engineCommits.slice(0, 40) : ["None."]));
  if (engineCommits.length > 40) report.push(`- … ${engineCommits.length - 40} more`);

  // Export drift is read-only: safe in dry run too (imports read from the working tree).
  const exportSection = (): string => {
    try {
      const before = loadEngineSnapshot(root, mergeBase);
      const after = loadEngineSnapshot(root, target);
      const imports = scanOurImports(root, OUR_CLIENT_SRC);
      const diff = diffExports(before, after, imports);
      outputs.export_breaks = diff.summary.breaking;
      return renderExportDiff(diff);
    } catch (e) {
      return `_Export diff failed: ${(e as Error).message}_`;
    }
  };
  if (dryRun) {
    report.push("", "## Removed/renamed exports we import", "", exportSection());
    report.push("", "_Dry run: no branch created, nothing merged, nothing written._");
    console.log(report.toString());
    outputs.seam_files_touched = seamFilesTouched.length;
    finish("clean", 0);
  }
  const originalBranch = currentBranch(root);
  if (branchExists(root, branch)) {
    fail(
      `Branch \`${branch}\` already exists. Delete it (git branch -D ${branch}) or pass --branch <other-name>.`,
    );
  }
  if (gitTry(root, ["config", "--get", "rerere.enabled"]) !== "true")
    git(root, ["config", "rerere.enabled", "true"]);
  if (gitTry(root, ["config", "--get", "rerere.autoupdate"]) !== "true")
    git(root, ["config", "rerere.autoupdate", "true"]);
  if (!gitTry(root, ["config", "--get", "user.email"])) {
    git(root, ["config", "user.email", "nondev-sync@users.noreply.github.com"]);
    git(root, ["config", "user.name", "nondev-sync[bot]"]);
  }

  console.log(`Creating ${branch} from ${baseBranch} …`);
  git(root, ["switch", "-c", branch, baseBranch]);

  const abortAndLeave = (why: string, extra: string[] = []): never => {
    run("git", ["merge", "--abort"], { cwd: root });
    run("git", ["switch", originalBranch ?? baseBranch], { cwd: root });
    run("git", ["branch", "-D", branch], { cwd: root });
    report.push(
      "",
      "## ✖ Merge aborted",
      "",
      why,
      ...extra,
      "",
      `The repository is back on \`${originalBranch ?? baseBranch}\` with no sync branch. Nothing was changed.`,
    );
    console.log(report.toString());
    // Do not write into the working tree here: we are back on the base branch and must leave it clean.
    const scratch = process.env.RUNNER_TEMP
      ? NodePath.join(process.env.RUNNER_TEMP, "sync-abort-report.md")
      : null;
    if (scratch) NodeFS.writeFileSync(scratch, report.toString());
    if (process.env.GITHUB_STEP_SUMMARY)
      NodeFS.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.toString());
    finish("aborted", 2);
  };

  console.log(`Merging upstream/${upstreamRef} (${target.slice(0, 10)}) …`);
  const merge = run("git", ["merge", "--no-ff", "--no-commit", "--no-edit", target], { cwd: root });
  const unmerged = gitLines(root, ["diff", "--name-only", "--diff-filter=U"]);
  // Paths git reported as conflicting but that are no longer unmerged were resolved by rerere
  // (rerere.autoupdate stages a remembered resolution). They still need the same bookkeeping.
  const reportedConflicts = parseConflictPaths(merge.out);
  const rerereResolved = reportedConflicts.filter((p) => !unmerged.includes(p));
  if (!merge.ok && unmerged.length === 0 && rerereResolved.length === 0) {
    abortAndLeave("`git merge` failed without listing conflicted files:", [
      "",
      "```",
      tail(merge.out),
      "```",
    ]);
  }

  const conflicts: Conflict[] = [];
  const unexpected: string[] = [];
  const rerereUndeclared: string[] = [];
  for (const path of unmerged) {
    if (path === "pnpm-lock.yaml") {
      const how = takeSide(root, path, "theirs");
      conflicts.push({ path, kind: "lockfile", resolution: `${how}; re-resolved below` });
    } else if (isOurPath(path)) {
      const how = takeSide(root, path, "ours");
      conflicts.push({
        path,
        kind: "ours",
        resolution: `${how} (upstream touched a path this fork owns — check by hand)`,
      });
    } else {
      const seams = findSeamsForPath(manifest.seams, path);
      if (seams.length) {
        const how = takeSide(root, path, "theirs");
        conflicts.push({
          path,
          kind: "seam",
          resolution: `${how}; seam(s) ${seams.map((s) => s.id).join(", ")} need re-applying`,
          seams,
        });
      } else {
        unexpected.push(path);
      }
    }
  }
  for (const path of rerereResolved) {
    const remembered = "git rerere replayed a remembered resolution";
    if (path === "pnpm-lock.yaml") {
      conflicts.push({
        path,
        kind: "lockfile",
        resolution: `${remembered}; re-resolved below anyway`,
      });
    } else if (isOurPath(path)) {
      conflicts.push({ path, kind: "ours", resolution: `${remembered} — check by hand` });
    } else {
      const seams = findSeamsForPath(manifest.seams, path);
      if (seams.length === 0) {
        rerereUndeclared.push(path);
        conflicts.push({
          path,
          kind: "unexpected",
          resolution: `${remembered} in an UNDECLARED file — verify, then declare or revert`,
        });
        continue;
      }
      const content = NodeFS.existsSync(NodePath.join(root, path))
        ? NodeFS.readFileSync(NodePath.join(root, path), "utf8")
        : "";
      const intact = seams.every((sm) => sm.marker !== null && content.includes(sm.marker));
      conflicts.push({
        path,
        kind: "seam",
        resolution: intact
          ? `${remembered}; marker(s) present, seam intact`
          : `${remembered}; marker missing or not defined — seam(s) ${seams.map((s) => s.id).join(", ")} need checking/re-applying`,
        seams: intact ? [] : seams,
      });
    }
  }
  if (unexpected.length) {
    abortAndLeave(
      `Conflicts in upstream-owned files that are **not declared in ${MANIFEST_PATH}**. A human must decide:`,
      [
        "",
        ...unexpected.map((p) => `- \`${p}\``),
        "",
        "Either add each file to the manifest (if we really meant to change it) or revert our change to it on `main`, then run the sync again.",
      ],
    );
  }

  let lockfile: StepResult | null = null;
  if (conflicts.some((c) => c.kind === "lockfile")) {
    const pm = packageManager(root);
    lockfile = runTool(root, "lockfile re-resolution", pm, ["install", "--lockfile-only"]);
    git(root, ["add", "--", "pnpm-lock.yaml"]);
  }

  const conflictSummary = conflicts.map((c) => `${c.kind}: ${c.path}`).join("\n");
  git(root, [
    "commit",
    "--no-verify",
    "-m",
    `chore(sync): merge upstream/${upstreamRef} ${target.slice(0, 10)} (${commits} commits)${conflictSummary ? `\n\n${conflictSummary}` : ""}`,
  ]);
  const mergeCommit = git(root, ["rev-parse", "HEAD"]);
  outputs.merge_commit = mergeCommit;
  const seamsToReapply = conflicts.filter((c) => c.kind === "seam" && (c.seams?.length ?? 0) > 0);

  // A marker counts as lost only if it existed on the base branch before this merge and is gone
  // after it. Markers that were never adopted are check-seams --strict's business, not the sync's.
  const markerLost: Array<{ seam: Seam; path: string }> = [];
  for (const seam of manifest.seams) {
    if (!seam.marker || /[*?]/.test(seam.file)) continue;
    if (seamsToReapply.some((c) => c.path === seam.file)) continue;
    const before = gitTry(root, ["show", `${baseBranch}:${seam.file}`]);
    if (!before || !before.includes(seam.marker)) continue;
    const full = NodePath.join(root, seam.file);
    if (!NodeFS.existsSync(full) || !NodeFS.readFileSync(full, "utf8").includes(seam.marker)) {
      markerLost.push({ seam, path: seam.file });
    }
  }

  report.push("", "## Conflicts and how they were resolved", "");
  if (conflicts.length === 0) report.push("No conflicts. git merged everything on its own.");
  for (const c of conflicts) report.push(`- \`${c.path}\` — **${c.kind}** — ${c.resolution}`);
  if (rerereResolved.length)
    report.push(
      "",
      `git rerere remembered earlier resolutions for: ${rerereResolved.map((p) => `\`${p}\``).join(", ")}`,
    );
  if (lockfile) {
    report.push(
      "",
      lockfile.ok
        ? "`pnpm-lock.yaml`: took upstream's lockfile and re-resolved our additions with `install --lockfile-only` ✔"
        : "`pnpm-lock.yaml`: **re-resolution FAILED** — upstream probably removed a catalog entry or override we rely on. Fix `apps/nondev/package.json`, run `vp install --lockfile-only`, commit.",
      "",
      "<details><summary>install log</summary>",
      "",
      "```",
      tail(lockfile.log),
      "```",
      "",
      "</details>",
    );
  }

  report.push("", "## Seams needing re-apply", "");
  if (seamsToReapply.length === 0 && markerLost.length === 0)
    report.push("None. Every declared seam still carries its marker after the merge.");
  for (const c of seamsToReapply) {
    report.push(
      `### \`${c.path}\``,
      "",
      `Upstream's version was taken. Re-apply seam(s): ${c.seams!.map((s) => `**${s.id}** (${s.reason || "no reason recorded"})`).join("; ")}.`,
      "",
      "Our change, relative to the previous upstream base (apply by hand or with `git apply -3`):",
      "",
      "```diff",
    );
    const patch = gitTry(root, ["diff", `${mergeBase}..${baseBranch}`, "--", c.path]) ?? "";
    report.push(
      tail(patch, 120, 8000) || "(no diff — the seam may have been identical to upstream already)",
      "```",
      "",
    );
  }
  for (const { seam, path } of markerLost) {
    report.push(
      `- \`${path}\`: marker \`${seam.marker}\` is missing after the merge although git reported no conflict. git may have auto-resolved towards upstream; re-check seam **${seam.id}**.`,
    );
  }
  const steps: StepResult[] = [];
  if (verify) {
    const pm = packageManager(root);
    const install = runTool(root, "install", pm, ["install", "--no-frozen-lockfile"]);
    steps.push(install);
    if (gitLines(root, ["status", "--porcelain", "--", "pnpm-lock.yaml"]).length) {
      git(root, ["add", "--", "pnpm-lock.yaml"]);
      git(root, [
        "commit",
        "--no-verify",
        "-m",
        "chore(sync): re-resolve pnpm-lock.yaml after upstream merge",
      ]);
      report.push(
        "",
        "> ℹ `pnpm-lock.yaml` needed an update after the merge (no textual conflict, but out of date). Committed separately.",
      );
    }
    if (install.ok) {
      steps.push(runTool(root, "typecheck", "vp", ["run", "--filter", OUR_PACKAGE, "typecheck"]));
      steps.push(runTool(root, "build", "vp", ["run", "--filter", OUR_PACKAGE, "build"]));
    } else {
      steps.push(
        { name: "typecheck", ok: false, skipped: true, log: "skipped: install failed" },
        { name: "build", ok: false, skipped: true, log: "skipped: install failed" },
      );
    }
  }
  report.push("", "## Checks", "", "| step | result |", "|---|---|");
  if (!verify) report.push("| install / typecheck / build | skipped (`--no-verify`) |");
  for (const s of steps)
    report.push(`| ${s.name} | ${s.ok ? "✔ passed" : s.skipped ? "⏭ skipped" : "✖ **failed**"} |`);
  for (const s of steps.filter((s) => !s.ok && !s.skipped)) {
    report.push(
      "",
      `<details><summary>${s.name} log (tail)</summary>`,
      "",
      "```",
      tail(s.log, 80, 8000),
      "```",
      "",
      "</details>",
    );
  }

  report.push("", "## Removed/renamed exports we import", "", exportSection());
  const verifyFailed = steps.some((s) => !s.ok);
  const needsHuman =
    rerereUndeclared.length > 0 ||
    verifyFailed ||
    seamsToReapply.length > 0 ||
    markerLost.length > 0 ||
    (lockfile !== null && !lockfile.ok) ||
    conflicts.some((c) => c.kind === "ours");
  const status: Status = needsHuman ? "needs-human" : "clean";
  const reasons: string[] = [];
  if (seamsToReapply.length) reasons.push(`${seamsToReapply.length} seam(s) need re-applying`);
  if (markerLost.length) reasons.push(`${markerLost.length} seam marker(s) missing`);
  if (lockfile && !lockfile.ok) reasons.push("lockfile re-resolution failed");
  if (steps.some((s) => s.name === "typecheck" && !s.ok)) reasons.push("typecheck failed");
  if (steps.some((s) => s.name === "build" && !s.ok)) reasons.push("build failed");
  if (steps.some((s) => s.name === "install" && !s.ok)) reasons.push("install failed");
  if (conflicts.some((c) => c.kind === "ours")) reasons.push("upstream touched a path we own");
  if (rerereUndeclared.length) reasons.push("rerere resolved a conflict in an undeclared file");
  outputs.reasons = reasons.join("; ");
  outputs.seams_reapply = JSON.stringify(seamsToReapply.map((c) => c.path));
  outputs.conflicts = JSON.stringify(conflicts.map((c) => c.path));
  outputs.lockfile_regenerated = lockfile !== null;

  report.push(
    "",
    "## Verdict",
    "",
    status === "clean"
      ? "✅ **Clean** — merged with no seam work and all checks green. Safe to merge."
      : `⚠️ **Needs a human** — ${reasons.join("; ")}. See nondev/README.md → "When the sync PR is red".`,
  );
  report.push(
    "",
    `_Generated by \`nondev/scripts/upstream-sync.ts\` on ${new Date().toISOString()}; merge commit \`${mergeCommit.slice(0, 10)}\`._`,
  );

  if (reportPath) {
    writeReport(root, reportPath, report);
    git(root, ["add", "--", reportPath]);
    git(root, ["commit", "--no-verify", "-m", `chore(sync): sync report ${date}`]);
  }
  console.log(`\n${report.toString()}`);
  console.log(
    `\nYou are now on branch \`${branch}\`. Push it and open a PR against \`${baseBranch}\`, or \`git switch ${originalBranch ?? baseBranch}\` to go back.`,
  );
  finish(status, status === "clean" ? 0 : 1);
}

function writeReport(root: string, reportPath: string, report: Report): void {
  const full = NodePath.join(root, reportPath);
  NodeFS.mkdirSync(NodePath.dirname(full), { recursive: true });
  NodeFS.writeFileSync(full, report.toString());
  console.log(`Report written to ${reportPath}`);
}

try {
  main();
} catch (e) {
  fail((e as Error).stack ?? String(e));
}
