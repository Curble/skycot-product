/**
 * Pure helpers shared by the nondev fork tooling (upstream-sync.ts, check-seams.ts).
 *
 * Everything in here is side-effect free so it can be unit tested with `node --test`.
 * Runs on plain Node (type stripping) with no build step: keep to erasable TypeScript
 * (no enums, no parameter properties, no namespaces).
 */
// Paths this fork owns outright. Anything matching these never needs a seam entry.
// Keep in sync with nondev/README.md ("Folder rules") and SEAM-MANIFEST.template.md.
export const OUR_PATH_GLOBS = [
  "apps/nondev/**",
  "apps/nondev/themes-community/**",
  "apps/skycot-mobile/**",
  "apps/server/src/skycot/**",
  "packages/skycot-rules/**",
  "packages/skycot-brand/**",
  "packages/skycot-relay/**",
  "infra/skycot-relay/**",
  "apps/desktop/src/skycot/**",
  "nondev/**",
  "docs/nondev/**",
  "docs/legal/**",
  "docs/security/**",
  "docs/qa/**",
  "docs/skycot-site/**",
  "docs/brand/**",
  "docs/marketing/**",
  ".github/workflows/nondev-*.yml",
  "SEAM-MANIFEST.md",
  "NOTICE",
  "CONTRIBUTING-THEMES.md",
] as const;

export const MANIFEST_PATH = "SEAM-MANIFEST.md";

/**
 * Upstream paths where a change can alter who may do what, what runs in CI, or what gets
 * installed. A nightly merge that touches any of them is never "clean": the sync marks it
 * `needs-human` and lists the commits so the reviewer reads those first (audit SEC-10).
 */
export const SENSITIVE_PATH_GLOBS = [
  ".github/**",
  "apps/server/src/auth/**",
  "apps/server/src/http.ts",
  "apps/server/src/httpCors.ts",
  "apps/desktop/src/electron/**",
  "packages/contracts/src/auth.ts",
  "packages/contracts/src/clientRpcPermissions.ts",
  "**/package.json",
  "pnpm-workspace.yaml",
  "patches/**",
  "scripts/**",
] as const;

export function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATH_GLOBS.some((g) => matchesGlob(g, path));
}

/**
 * Generated files that legitimately differ from upstream without being seams: the lockfile
 * changes whenever apps/nondev adds a dependency and is re-resolved mechanically by the sync.
 */
export const GENERATED_ALLOWED = ["pnpm-lock.yaml"] as const;

export function isGeneratedAllowed(path: string): boolean {
  return (GENERATED_ALLOWED as readonly string[]).includes(path);
}

/** Upstream packages our client compiles against as raw TypeScript source. */
export const ENGINE_PACKAGES = [
  { name: "@t3tools/contracts", dir: "packages/contracts" },
  { name: "@t3tools/client-runtime", dir: "packages/client-runtime" },
  { name: "@t3tools/shared", dir: "packages/shared" },
] as const;

export const OUR_CLIENT_SRC = "apps/nondev/src";
// Glob matching (subset: `**`, `*`, `?`; always anchored to the whole path)
export function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // `**/` matches zero or more directories; a trailing `**` matches the rest.
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if ("\\^$+.()|{}[]".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`${out}$`);
}

export function matchesGlob(glob: string, path: string): boolean {
  if (glob === path) return true;
  return globToRegExp(glob).test(path);
}

export function isOurPath(path: string): boolean {
  return OUR_PATH_GLOBS.some((g) => matchesGlob(g, path));
}
// SEAM-MANIFEST.md parsing
export interface Seam {
  /** Short stable identifier, e.g. `server-copy-dist`. */
  id: string;
  /** Repo-relative path or glob of the upstream file we modify. */
  file: string;
  /** Free text: line numbers or region, informational only. */
  lines: string;
  reason: string;
  /**
   * Literal text that must be present in the file after every merge, or `null` when the
   * file cannot carry a marker (JSON, binary). Defaults to `nondev-seam: <id>`.
   */
  marker: string | null;
  upstreamChurn: string;
}

export interface ParsedManifest {
  seams: Seam[];
  /** Human-readable notes about how the manifest was read (missing columns, fallbacks). */
  warnings: string[];
}

/** Marker cells meaning "this file cannot carry a marker": `none`, `none (JSON)`, `n/a`, `-`, `(binary)` … */
const NO_MARKER =
  /^(?:(?:none|n\/a|no[- ]marker|-|–|—)(?:\b.*)?|\(?(?:binary|json|yaml|lockfile|no comments?)[^)]*\)?)$/i;

function stripCell(cell: string): string {
  return cell
    .trim()
    .replace(/^`+|`+$/g, "")
    .trim();
}

function splitRow(line: string): string[] {
  // `| a | b |` -> ["a", "b"]; tolerate a missing leading/trailing pipe.
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function isSeparatorRow(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

export function defaultMarker(id: string): string {
  return `nondev-seam: ${id}`;
}

export function idFromPath(path: string): string {
  return path
    .replace(/\*+/g, "all")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * Reads every markdown table in the manifest whose header has a `file`/`path` column.
 * Column order is free; unknown columns are ignored. If no such table exists, falls back
 * to collecting back-ticked repo paths so a hand-written manifest still protects something.
 */
export function parseManifest(markdown: string): ParsedManifest {
  const lines = markdown.split(/\r?\n/);
  const seams: Seam[] = [];
  const warnings: string[] = [];
  let sawTable = false;

  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i]!;
    if (!header.includes("|") || !isSeparatorRow(lines[i + 1]!)) continue;
    const cols = splitRow(header).map((c) => c.toLowerCase());
    const col = (...names: string[]) => {
      const idx = cols.findIndex((c) => names.some((n) => c === n || c.startsWith(n)));
      return idx;
    };
    const fileCol = col("file", "path");
    if (fileCol < 0) continue;
    sawTable = true;
    const idCol = col("id", "seam", "#", "no");
    const linesCol = col("lines", "line", "where", "region");
    const reasonCol = col("reason", "why", "purpose", "change");
    const markerCol = col("marker");
    const churnCol = col("upstream churn", "churn", "risk");
    if (idCol < 0) warnings.push("Manifest table has no `id` column; ids derived from paths.");
    if (markerCol < 0) {
      warnings.push(
        "Manifest table has no `marker` column; using the default `nondev-seam: <id>` for every row.",
      );
    }

    for (let r = i + 2; r < lines.length; r++) {
      const row = lines[r]!;
      if (!row.trim().startsWith("|")) break;
      const cells = splitRow(row);
      const file = stripCell(cells[fileCol] ?? "");
      if (!file || file.toLowerCase() === "file" || file.toLowerCase() === "path") continue;
      const id =
        idCol >= 0 && stripCell(cells[idCol] ?? "") ? stripCell(cells[idCol]!) : idFromPath(file);
      const rawMarker = markerCol >= 0 ? stripCell(cells[markerCol] ?? "") : "";
      let marker: string | null;
      if (rawMarker === "") marker = defaultMarker(id);
      else if (NO_MARKER.test(rawMarker)) marker = null;
      else
        marker = rawMarker.replace(/^(?:\/\/|#|<!--|\/\*)\s*/, "").replace(/\s*(?:-->|\*\/)$/, "");
      seams.push({
        id,
        file,
        lines: linesCol >= 0 ? stripCell(cells[linesCol] ?? "") : "",
        reason: reasonCol >= 0 ? stripCell(cells[reasonCol] ?? "") : "",
        marker,
        upstreamChurn: churnCol >= 0 ? stripCell(cells[churnCol] ?? "") : "",
      });
    }
  }

  if (!sawTable) {
    const found = new Set<string>();
    for (const m of markdown.matchAll(/`([A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.*@-]+)+)`/g)) {
      const p = m[1]!;
      if (p.startsWith("http") || p.includes("://")) continue;
      found.add(p);
    }
    if (found.size > 0) {
      warnings.push(
        `Manifest has no table with a \`file\` column; treating ${found.size} back-ticked path(s) as declared seams (markers cannot be checked). Please convert to the table format in nondev/SEAM-MANIFEST.template.md.`,
      );
      for (const p of found) {
        seams.push({
          id: idFromPath(p),
          file: p,
          lines: "",
          reason: "",
          marker: null,
          upstreamChurn: "",
        });
      }
    } else {
      warnings.push(
        "Manifest contains no seam table and no back-ticked paths: nothing is declared.",
      );
    }
  }

  // Duplicate paths are allowed (several seams in one file) but duplicate ids are not.
  const ids = new Map<string, number>();
  for (const s of seams) ids.set(s.id, (ids.get(s.id) ?? 0) + 1);
  for (const [id, n] of ids)
    if (n > 1) warnings.push(`Seam id \`${id}\` appears ${n} times; ids must be unique.`);

  return { seams, warnings };
}

export function findSeamsForPath(seams: readonly Seam[], path: string): Seam[] {
  return seams.filter((s) => matchesGlob(s.file, path));
}

/** Declared seam paths that are concrete files (not globs), de-duplicated. */
export function seamFiles(seams: readonly Seam[]): string[] {
  return [...new Set(seams.map((s) => s.file).filter((f) => !/[*?]/.test(f)))];
}
// Export / import analysis for the "did upstream remove something we use" report
const IDENT = "[A-Za-z_$][\\w$]*";

function stripComments(source: string): string {
  // Good enough for export scanning: drop block comments and full-line `//` comments.
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function splitNameList(list: string): string[] {
  return list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^type\s+/, ""));
}

export interface ExportScan {
  /** Names exported directly or via `export { a as b }` / `export * as ns`. */
  names: Set<string>;
  /** Relative module specifiers from `export * from "./x"` (names unknown without following). */
  starFrom: string[];
}

export function extractExports(source: string): ExportScan {
  const src = stripComments(source);
  const names = new Set<string>();
  const starFrom: string[] = [];

  const decl = new RegExp(
    `^\\s*export\\s+(?:declare\\s+)?(?:async\\s+)?(?:const|let|var|function\\*?|class|abstract\\s+class|type|interface|enum|const\\s+enum|namespace)\\s+(${IDENT})`,
    "gm",
  );
  for (const m of src.matchAll(decl)) names.add(m[1]!);

  if (/^\s*export\s+default\b/m.test(src)) names.add("default");

  for (const m of src.matchAll(/^\s*export\s+\*\s+as\s+(\w+)\s+from\s*["'][^"']+["']/gm))
    names.add(m[1]!);
  for (const m of src.matchAll(/^\s*export\s+\*\s+from\s*["']([^"']+)["']/gm)) starFrom.push(m[1]!);

  for (const m of src.matchAll(/^\s*export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const item of splitNameList(m[1]!)) {
      const parts = item.split(/\s+as\s+/);
      names.add((parts[1] ?? parts[0]!).trim());
    }
  }

  // `export const { a, b } = ...` destructuring
  for (const m of src.matchAll(/^\s*export\s+(?:const|let|var)\s+\{([^}]*)\}\s*=/gm)) {
    for (const item of splitNameList(m[1]!)) {
      const parts = item.split(/\s*:\s*/);
      names.add((parts[1] ?? parts[0]!).trim());
    }
  }
  return { names, starFrom };
}

export interface ImportUse {
  specifier: string;
  /** Imported names; `default` for default imports; `*` for namespace imports. */
  names: string[];
}

export function extractImports(
  source: string,
  specifierFilter?: (spec: string) => boolean,
): ImportUse[] {
  const src = stripComments(source);
  const uses: ImportUse[] = [];
  const re = /(?:^|;)\s*(?:import|export)\s+(type\s+)?([^;"']*?)\s*from\s*["']([^"']+)["']/gm;
  for (const m of src.matchAll(re)) {
    const clause = m[2]!.trim();
    const spec = m[3]!;
    if (specifierFilter && !specifierFilter(spec)) continue;
    const names: string[] = [];
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) {
      for (const item of splitNameList(braces[1]!)) {
        const parts = item.split(/\s+as\s+/);
        names.push(parts[0]!.trim());
      }
    }
    const rest = clause.replace(/\{[^}]*\}/, "").trim();
    if (/\*\s+as\s+\w+/.test(rest) || rest === "*") names.push("*");
    const def = rest
      .replace(/\*\s+as\s+\w+/, "")
      .replace(/,/g, "")
      .trim();
    if (def && /^[A-Za-z_$][\w$]*$/.test(def)) names.push("default");
    uses.push({ specifier: spec, names });
  }
  for (const m of src.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    const spec = m[1]!;
    if (specifierFilter && !specifierFilter(spec)) continue;
    uses.push({ specifier: spec, names: ["*"] });
  }
  return uses;
}

/** Minimal package.json `exports` resolver: returns the package-relative source path or null. */
export function resolveExportSubpath(exportsMap: unknown, subpath: string): string | null {
  if (typeof exportsMap === "string") return subpath === "." ? exportsMap : null;
  if (!exportsMap || typeof exportsMap !== "object") return null;
  const map = exportsMap as Record<string, unknown>;
  const pick = (value: unknown): string | null => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      const v = value as Record<string, unknown>;
      for (const key of ["types", "import", "default", "node", "browser"]) {
        const r = pick(v[key]);
        if (r) return r;
      }
    }
    return null;
  };
  if (subpath in map) return pick(map[subpath]);
  for (const [pattern, target] of Object.entries(map)) {
    if (!pattern.includes("*")) continue;
    const [pre, post = ""] = pattern.split("*") as [string, string?];
    if (
      subpath.startsWith(pre) &&
      subpath.endsWith(post) &&
      subpath.length >= pre.length + post.length
    ) {
      const wildcard = subpath.slice(pre.length, subpath.length - post.length);
      const t = pick(target);
      return t ? t.replace("*", wildcard) : null;
    }
  }
  return null;
}

/** Splits `@t3tools/shared/devProxy` into package name and `./devProxy` (or `.`). */
export function splitSpecifier(specifier: string): { pkg: string; subpath: string } | null {
  const m = specifier.match(/^(@[^/]+\/[^/]+|[^@][^/]*)(?:\/(.*))?$/);
  if (!m) return null;
  return { pkg: m[1]!, subpath: m[2] ? `./${m[2]}` : "." };
}

export type FileMap = Map<string, string>;

/** Joins a package-relative path (`./src/x.ts`) onto a package dir (`packages/shared`). */
export function joinPkgPath(pkgDir: string, rel: string): string {
  const parts = `${pkgDir}/${rel.replace(/^\.\//, "")}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

function resolveRelativeModule(files: FileMap, fromFile: string, spec: string): string | null {
  const dir = fromFile.split("/").slice(0, -1).join("/");
  const base = joinPkgPath(dir, spec).replace(/\.(?:js|mjs|ts|tsx)$/, "");
  for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (files.has(cand)) return cand;
  }
  return null;
}

/** All names a module exports, following `export * from "./relative"` within the snapshot. */
export function collectModuleExports(
  files: FileMap,
  file: string,
  seen = new Set<string>(),
): Set<string> {
  const out = new Set<string>();
  if (seen.has(file)) return out;
  seen.add(file);
  const source = files.get(file);
  if (source === undefined) return out;
  const scan = extractExports(source);
  for (const n of scan.names) out.add(n);
  for (const spec of scan.starFrom) {
    if (!spec.startsWith(".")) continue;
    const target = resolveRelativeModule(files, file, spec);
    if (!target) continue;
    for (const n of collectModuleExports(files, target, seen)) if (n !== "default") out.add(n);
  }
  return out;
}

export interface Snapshot {
  /** repo path -> file content, for every engine package source file plus each package.json */
  files: FileMap;
}

export interface ExportDiffEntry {
  specifier: string;
  modulePath: string | null;
  /** Names exported before but not after. */
  removed: string[];
  /** Subset of `removed` that our client imports (the actionable list). */
  removedAndUsed: string[];
  /** We import these names but the module never exported them at either snapshot (probably a parse limit). */
  unknownNames: string[];
  moduleRemoved: boolean;
  usedViaNamespace: boolean;
}

export interface ExportDiff {
  /** Per module we import, sorted by specifier. */
  entries: ExportDiffEntry[];
  /** Every removed export across the three packages, keyed by module path (for the long tail). */
  allRemoved: Map<string, string[]>;
  /** Package subpaths we import that no longer exist in `exports`. */
  summary: { modulesChecked: number; breaking: number; removedTotal: number };
}

function parseJson(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Compares exports between two snapshots of the engine packages against the imports our
 * client uses. `imports` is the merged list from scanning apps/nondev/src.
 */
export function diffExports(
  before: Snapshot,
  after: Snapshot,
  imports: readonly ImportUse[],
): ExportDiff {
  const byPkg = new Map(ENGINE_PACKAGES.map((p) => [p.name, p.dir] as const));

  // Long tail: every module in the three packages, before vs after.
  const allRemoved = new Map<string, string[]>();
  for (const [path, _] of before.files) {
    if (!/\.(ts|tsx)$/.test(path) || /\.test\.(ts|tsx)$/.test(path) || /\/test(s)?\//.test(path))
      continue;
    const prev = extractExports(before.files.get(path)!).names;
    const nextSrc = after.files.get(path);
    const next = nextSrc === undefined ? new Set<string>() : extractExports(nextSrc).names;
    const removed = [...prev].filter((n) => !next.has(n)).sort();
    if (removed.length) allRemoved.set(path, removed);
  }

  // Our imports, grouped by specifier.
  const grouped = new Map<string, Set<string>>();
  for (const use of imports) {
    const set = grouped.get(use.specifier) ?? new Set<string>();
    for (const n of use.names) set.add(n);
    grouped.set(use.specifier, set);
  }

  const entries: ExportDiffEntry[] = [];
  let breaking = 0;
  for (const [specifier, names] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const split = splitSpecifier(specifier);
    const pkgDir = split ? byPkg.get(split.pkg) : undefined;
    if (!split || !pkgDir) continue;
    const resolveIn = (snap: Snapshot): string | null => {
      const pkgJson = parseJson(snap.files.get(`${pkgDir}/package.json`));
      const rel = pkgJson ? resolveExportSubpath(pkgJson.exports, split.subpath) : null;
      if (rel) {
        const p = joinPkgPath(pkgDir, rel);
        return snap.files.has(p) ? p : p; // keep path even if missing so we can report it
      }
      // No exports map match: try a conventional src path.
      const guess =
        split.subpath === "."
          ? `${pkgDir}/src/index.ts`
          : joinPkgPath(pkgDir, `src/${split.subpath.slice(2)}.ts`);
      return snap.files.has(guess) ? guess : null;
    };
    const beforePath = resolveIn(before);
    const afterPath = resolveIn(after);
    const beforeNames = beforePath
      ? collectModuleExports(before.files, beforePath)
      : new Set<string>();
    const afterNames =
      afterPath && after.files.has(afterPath)
        ? collectModuleExports(after.files, afterPath)
        : new Set<string>();
    const moduleRemoved =
      Boolean(beforePath && before.files.has(beforePath)) &&
      !(afterPath && after.files.has(afterPath));
    const removed = [...beforeNames].filter((n) => !afterNames.has(n)).sort();
    const wanted = [...names].filter((n) => n !== "*");
    const removedAndUsed = moduleRemoved ? wanted : wanted.filter((n) => removed.includes(n));
    const unknownNames = wanted.filter((n) => !beforeNames.has(n) && !afterNames.has(n));
    const entry: ExportDiffEntry = {
      specifier,
      modulePath: afterPath ?? beforePath,
      removed,
      removedAndUsed,
      unknownNames,
      moduleRemoved,
      usedViaNamespace: names.has("*"),
    };
    if (entry.moduleRemoved || entry.removedAndUsed.length > 0) breaking++;
    entries.push(entry);
  }

  let removedTotal = 0;
  for (const v of allRemoved.values()) removedTotal += v.length;
  return {
    entries,
    allRemoved,
    summary: { modulesChecked: entries.length, breaking, removedTotal },
  };
}

export function renderExportDiff(diff: ExportDiff): string {
  const lines: string[] = [];
  const { modulesChecked, breaking, removedTotal } = diff.summary;
  lines.push(
    `Engine modules our client imports: **${modulesChecked}**. Removed/renamed exports across contracts, client-runtime and shared: **${removedTotal}**. Of those, **${breaking}** module(s) we import are affected.`,
  );
  if (modulesChecked === 0) {
    lines.push(
      "",
      "_No imports from `@t3tools/contracts`, `@t3tools/client-runtime` or `@t3tools/shared` found under `apps/nondev/src` (the client may not exist yet)._",
    );
  }
  const bad = diff.entries.filter((e) => e.moduleRemoved || e.removedAndUsed.length > 0);
  if (bad.length) {
    lines.push("", "### Likely typecheck breaks (we import something upstream removed)", "");
    for (const e of bad) {
      if (e.moduleRemoved)
        lines.push(
          `- \`${e.specifier}\` — **module removed** (was \`${e.modulePath}\`); we import: ${e.removedAndUsed.map((n) => `\`${n}\``).join(", ") || "(namespace)"}`,
        );
      else
        lines.push(
          `- \`${e.specifier}\` — removed: ${e.removedAndUsed.map((n) => `\`${n}\``).join(", ")}`,
        );
    }
  } else if (modulesChecked > 0) {
    lines.push("", "Nothing we import was removed or renamed.");
  }
  const ns = diff.entries.filter((e) => e.usedViaNamespace && e.removed.length && !bad.includes(e));
  if (ns.length) {
    lines.push("", "### Namespace imports to eyeball (`import * as`)", "");
    for (const e of ns)
      lines.push(
        `- \`${e.specifier}\` lost: ${e.removed
          .slice(0, 20)
          .map((n) => `\`${n}\``)
          .join(", ")}${e.removed.length > 20 ? ", …" : ""}`,
      );
  }
  const unknown = diff.entries.filter((e) => e.unknownNames.length);
  if (unknown.length) {
    lines.push(
      "",
      "### Names we import that the scanner could not find in either version (check by hand)",
      "",
    );
    for (const e of unknown)
      lines.push(`- \`${e.specifier}\`: ${e.unknownNames.map((n) => `\`${n}\``).join(", ")}`);
  }
  if (diff.allRemoved.size) {
    lines.push(
      "",
      "<details><summary>All removed exports (long tail, not necessarily used by us)</summary>",
      "",
    );
    let shown = 0;
    for (const [path, names] of [...diff.allRemoved].sort(([a], [b]) => a.localeCompare(b))) {
      if (shown++ >= 80) {
        lines.push(`- … ${diff.allRemoved.size - 80} more modules`);
        break;
      }
      lines.push(
        `- \`${path}\`: ${names.slice(0, 12).join(", ")}${names.length > 12 ? ", …" : ""}`,
      );
    }
    lines.push("", "</details>");
  }
  return lines.join("\n");
}
// Small formatting helpers
/** Paths named in git's `CONFLICT (...)` lines, whatever the conflict type. */
export function parseConflictPaths(mergeOutput: string): string[] {
  const paths = new Set<string>();
  for (const line of mergeOutput.split("\n")) {
    const m = line.match(/^CONFLICT \([^)]*\): (.*)$/);
    if (!m) continue;
    const rest = m[1]!;
    const deleted = rest.match(/^(\S+) deleted in /);
    const renamed = rest.match(/^Rename (\S+)->/);
    const inFile = rest.match(/^Merge conflict in (.+)$/);
    const p = deleted?.[1] ?? renamed?.[1] ?? inFile?.[1];
    if (p) paths.add(p.trim());
  }
  return [...paths];
}

export function tail(text: string, maxLines = 60, maxChars = 6000): string {
  const lines = text.trimEnd().split("\n");
  const sliced = lines.slice(-maxLines).join("\n");
  return sliced.length > maxChars ? `…${sliced.slice(-maxChars)}` : sliced;
}

export function todayIso(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** GITHUB_OUTPUT-compatible `key=value` lines (values must be single-line). */
export function formatOutputs(values: Record<string, string | number | boolean>): string {
  return Object.entries(values)
    .map(([k, v]) => `${k}=${String(v).replace(/\r?\n/g, " ")}`)
    .join("\n")
    .concat("\n");
}
