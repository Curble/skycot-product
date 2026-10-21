#!/usr/bin/env node
/**
 * check-seams — verifies that every upstream-owned file this fork has changed is declared
 * in SEAM-MANIFEST.md, and that each declared seam still carries its marker comment.
 *
 *   node nondev/scripts/check-seams.ts [--strict] [--working-tree] [--upstream-ref upstream/main]
 *                                      [--manifest SEAM-MANIFEST.md] [--base <sha>] [--quiet]
 *
 * What it compares: `git diff --name-only <merge-base(upstream/main, HEAD)>..HEAD`, i.e. every
 * file that differs between us and the point where we last matched upstream. Paths the fork owns
 * outright (apps/nondev/**, nondev/**, docs/nondev/**, .github/workflows/nondev-*.yml,
 * SEAM-MANIFEST.md) are subtracted. Whatever is left must be declared.
 *
 * Exit codes
 *   0  every changed upstream file is declared (markers may be missing unless --strict)
 *   1  undeclared upstream changes, or (with --strict) a declared seam lost its marker
 *   2  could not run (not a git repo, upstream remote missing, manifest unreadable)
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { git, gitLines, gitTry, hasRemote, repoRoot } from "./git.ts";
import {
  MANIFEST_PATH,
  type Seam,
  findSeamsForPath,
  isGeneratedAllowed,
  isOurPath,
  matchesGlob,
  parseManifest,
} from "./lib.ts";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

export interface SeamCheck {
  base: string;
  changedUpstreamFiles: string[];
  undeclared: string[];
  declaredChanged: string[];
  /** Declared seam paths (non-glob) that do not differ from upstream at all: stale manifest rows. */
  declaredUnchanged: string[];
  markerMissing: Array<{ seam: Seam; reason: string }>;
  markerOk: Seam[];
  /** Generated files (pnpm-lock.yaml) that differ: allowed, listed for information. */
  generatedChanged: string[];
  manifestWarnings: string[];
  manifestFound: boolean;
}

export function runSeamCheck(opts: {
  root: string;
  upstreamRef: string;
  base?: string;
  manifestPath: string;
  workingTree: boolean;
}): SeamCheck {
  const { root } = opts;
  const base = opts.base ?? git(root, ["merge-base", opts.upstreamRef, "HEAD"]);

  // Files that differ between the merge-base and HEAD (or the working tree, locally).
  const changed = new Set<string>(
    opts.workingTree
      ? [
          ...gitLines(root, ["diff", "--name-only", base]),
          ...gitLines(root, ["ls-files", "--others", "--exclude-standard"]),
        ]
      : gitLines(root, ["diff", "--name-only", `${base}..HEAD`]),
  );

  const manifestFile = NodePath.join(root, opts.manifestPath);
  const manifestFound = NodeFS.existsSync(manifestFile);
  const parsed = manifestFound
    ? parseManifest(NodeFS.readFileSync(manifestFile, "utf8"))
    : { seams: [], warnings: [] };
  if (!manifestFound)
    parsed.warnings.push(
      `${opts.manifestPath} not found: every upstream change counts as undeclared.`,
    );

  const generatedChanged = [...changed].filter((p) => isGeneratedAllowed(p)).sort();
  const changedUpstreamFiles = [...changed]
    .filter((p) => !isOurPath(p) && !isGeneratedAllowed(p))
    .sort();
  const undeclared = changedUpstreamFiles.filter(
    (p) => findSeamsForPath(parsed.seams, p).length === 0,
  );
  const declaredChanged = changedUpstreamFiles.filter(
    (p) => findSeamsForPath(parsed.seams, p).length > 0,
  );
  const declaredUnchanged = parsed.seams
    .map((s) => s.file)
    .filter((f) => !/[*?]/.test(f) && !changed.has(f));

  const markerMissing: SeamCheck["markerMissing"] = [];
  const markerOk: Seam[] = [];
  for (const seam of parsed.seams) {
    if (seam.marker === null || isGeneratedAllowed(seam.file)) continue;
    if (/[*?]/.test(seam.file)) {
      // A glob seam: the marker must appear in at least one matching changed file.
      const matching = [...changed].filter((p) => matchesGlob(seam.file, p));
      const hit = matching.some(
        (p) =>
          NodeFS.existsSync(NodePath.join(root, p)) &&
          NodeFS.readFileSync(NodePath.join(root, p), "utf8").includes(seam.marker!),
      );
      if (hit) markerOk.push(seam);
      else
        markerMissing.push({
          seam,
          reason: matching.length
            ? "no matching file contains the marker"
            : "no changed file matches the glob",
        });
      continue;
    }
    const full = NodePath.join(root, seam.file);
    if (!NodeFS.existsSync(full)) {
      markerMissing.push({ seam, reason: "file does not exist (upstream deleted or moved it?)" });
      continue;
    }
    const content = opts.workingTree
      ? NodeFS.readFileSync(full, "utf8")
      : (gitTry(root, ["show", `HEAD:${seam.file}`]) ?? NodeFS.readFileSync(full, "utf8"));
    if (content.includes(seam.marker)) markerOk.push(seam);
    else markerMissing.push({ seam, reason: `marker \`${seam.marker}\` not found` });
  }

  return {
    base,
    changedUpstreamFiles,
    undeclared,
    declaredChanged,
    declaredUnchanged,
    markerMissing,
    markerOk,
    generatedChanged,
    manifestWarnings: parsed.warnings,
    manifestFound,
  };
}

export function renderSeamCheck(c: SeamCheck, strict: boolean): string {
  const L: string[] = [];
  L.push(`## Seam check`);
  L.push(`- Comparing against upstream merge-base \`${c.base.slice(0, 10)}\``);
  L.push(`- Upstream-owned files changed by this fork: **${c.changedUpstreamFiles.length}**`);
  L.push(
    `- Declared in manifest: ${c.declaredChanged.length} · Undeclared: **${c.undeclared.length}** · Markers present: ${c.markerOk.length} · Markers missing: ${c.markerMissing.length}`,
  );
  if (c.generatedChanged.length)
    L.push(
      `- Generated files that differ (allowed, re-resolved by the sync): ${c.generatedChanged.map((p) => `\`${p}\``).join(", ")}`,
    );
  for (const w of c.manifestWarnings) L.push(`- ⚠ ${w}`);
  if (c.undeclared.length) {
    L.push(
      "",
      "### ✖ Undeclared upstream changes (add a row to SEAM-MANIFEST.md or revert the file)",
      "",
    );
    for (const p of c.undeclared) L.push(`- \`${p}\``);
  }
  if (c.declaredChanged.length) {
    L.push("", "### Declared seams that currently differ from upstream", "");
    for (const p of c.declaredChanged) L.push(`- \`${p}\``);
  }
  if (c.markerMissing.length) {
    L.push(
      "",
      `### ${strict ? "✖" : "⚠"} Declared seams without their marker${strict ? "" : " (not fatal; run with --strict to enforce)"}`,
      "",
    );
    for (const { seam, reason } of c.markerMissing)
      L.push(
        `- \`${seam.file}\` (seam \`${seam.id}\`): ${reason}. Expected text: \`${seam.marker}\``,
      );
  }
  if (c.declaredUnchanged.length) {
    L.push(
      "",
      "### ℹ Declared seams that are identical to upstream (stale rows, or the seam was lost in a merge)",
      "",
    );
    for (const p of c.declaredUnchanged) L.push(`- \`${p}\``);
  }
  const fail = c.undeclared.length > 0 || (strict && c.markerMissing.length > 0);
  L.push(
    "",
    fail
      ? "**Result: FAIL**"
      : "**Result: OK** — every upstream file we changed is declared in the manifest.",
  );
  return L.join("\n");
}

function main(): void {
  const strict = flag("strict");
  const workingTree = flag("working-tree");
  const upstreamRef = option("upstream-ref", "upstream/main");
  const manifestPath = option("manifest", MANIFEST_PATH);
  const base = process.argv.includes("--base") ? option("base", "") : undefined;

  let root: string;
  try {
    root = repoRoot();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  if (!base && !upstreamRef.includes("/")) {
    // allow a raw sha/ref
  } else if (!base && upstreamRef.startsWith("upstream/") && !hasRemote(root, "upstream")) {
    console.error(
      "The `upstream` remote is missing. Add it with:\n  git remote add upstream https://github.com/pingdotgg/t3code.git && git fetch upstream\nor pass --base <sha> / --upstream-ref <ref>.",
    );
    process.exit(2);
  }
  if (!base && gitTry(root, ["rev-parse", "--verify", "--quiet", upstreamRef]) === null) {
    console.error(
      `Cannot resolve ${upstreamRef}. Run \`git fetch upstream\` first, or pass --base <sha>.`,
    );
    process.exit(2);
  }

  const check = runSeamCheck({
    root,
    upstreamRef,
    base: base || undefined,
    manifestPath,
    workingTree,
  });
  const report = renderSeamCheck(check, strict);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      NodeFS.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
    } catch {
      // summary is best-effort
    }
  }
  const fail = check.undeclared.length > 0 || (strict && check.markerMissing.length > 0);
  process.exit(fail ? 1 : 0);
}

if (process.argv[1]?.endsWith("check-seams.ts")) main();
