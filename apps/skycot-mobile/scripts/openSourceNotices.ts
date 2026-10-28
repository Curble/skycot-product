// nondev-seam: skycot-iphone-c8-notices-lib
/**
 * Collects the third-party packages the iPhone app ships, with their licence texts, from the
 * installed dependency tree of apps/skycot-mobile (production and optional dependencies only,
 * following workspace packages too). Used by scripts/generate-open-source-notices.ts to write
 * src/legal/openSourceNotices.json, and by the test that fails when that file is stale.
 */
import { createHash } from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface NoticePackage {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly sourceUrl: string | null;
  /** Key into `texts`. */
  readonly text: string;
}

/** SKYCOT's own licence and the upstream project it is based on, shown above the packages. */
export interface OwnNotice {
  readonly name: string;
  readonly license: string;
  readonly sourceUrl: string | null;
  readonly text: string;
}

export interface NoticeFile {
  readonly schemaVersion: 1;
  readonly own: ReadonlyArray<OwnNotice>;
  /** sha256 of the sorted "name@version" lines: the dependency set this file was made from. */
  readonly closureHash: string;
  readonly packages: ReadonlyArray<NoticePackage>;
  /** Licence texts by content hash, so identical texts are stored once. */
  readonly texts: Readonly<Record<string, string>>;
}

interface PackageJson {
  name?: string;
  version?: string;
  license?: unknown;
  licenses?: unknown;
  repository?: unknown;
  homepage?: unknown;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const FIRST_PARTY_SCOPE = "@t3tools/";
const LICENCE_FILE = /^(licen[cs]e|copying|notice|unlicense)([-._].*)?$/i;

export const APP_DIR = NodePath.resolve(import.meta.dirname, "..");

function readJson(file: string): PackageJson | null {
  try {
    return JSON.parse(NodeFS.readFileSync(file, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

/** Finds the directory a dependency resolves to from `fromDir`, the way Node does. */
function resolveDependency(name: string, fromDir: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = NodePath.join(dir, "node_modules", name);
    if (NodeFS.existsSync(NodePath.join(candidate, "package.json"))) {
      return NodeFS.realpathSync(candidate);
    }
    const parent = NodePath.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function licenceName(pkg: PackageJson): string {
  const l = pkg.license;
  if (typeof l === "string" && l.trim() !== "") return l.trim();
  if (typeof l === "object" && l !== null && "type" in l)
    return String((l as { type: unknown }).type);
  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
    return pkg.licenses
      .map((x) => (typeof x === "object" && x !== null && "type" in x ? String(x.type) : ""))
      .filter(Boolean)
      .join(" OR ");
  }
  return "UNKNOWN";
}

function sourceUrl(pkg: PackageJson): string | null {
  const repo = pkg.repository;
  const raw = typeof repo === "string" ? repo : (repo as { url?: unknown } | undefined)?.url;
  const candidate =
    typeof raw === "string" ? raw : typeof pkg.homepage === "string" ? pkg.homepage : null;
  if (candidate === null) return null;
  const cleaned = candidate
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/\.git$/, "")
    .replace(/^github:/, "https://github.com/");
  if (/^[\w.-]+\/[\w.-]+$/.test(cleaned)) return `https://github.com/${cleaned}`;
  return /^https?:\/\//.test(cleaned) ? cleaned : null;
}

function licenceText(dir: string): string | null {
  const files = NodeFS.readdirSync(dir)
    .filter((f) => LICENCE_FILE.test(f) && NodeFS.statSync(NodePath.join(dir, f)).isFile())
    .sort();
  if (files.length === 0) return null;
  return files
    .map((f) => NodeFS.readFileSync(NodePath.join(dir, f), "utf8").replace(/\r\n/g, "\n").trim())
    .join("\n\n---\n\n");
}

/** Every distinct installed package (name@version) the app ships, first-party ones excluded. */
export function collectDependencyClosure(): Map<string, string> {
  const seenDirs = new Set<string>();
  const found = new Map<string, string>();
  const visit = (dir: string) => {
    if (seenDirs.has(dir)) return;
    seenDirs.add(dir);
    const pkg = readJson(NodePath.join(dir, "package.json"));
    if (pkg === null) return;
    if (dir !== APP_DIR && pkg.name !== undefined && !pkg.name.startsWith(FIRST_PARTY_SCOPE)) {
      found.set(`${pkg.name}@${pkg.version ?? "0.0.0"}`, dir);
    }
    const wanted = new Set(Object.keys(pkg.dependencies ?? {}));
    for (const name of Object.keys(pkg.optionalDependencies ?? {})) wanted.add(name);
    for (const name of wanted) {
      const resolved = resolveDependency(name, dir);
      if (resolved !== null) visit(resolved);
    }
  };
  visit(APP_DIR);
  return found;
}

export function closureHash(keys: Iterable<string>): string {
  return createHash("sha256")
    .update([...keys].sort().join("\n"))
    .digest("hex");
}

function ownNotices(): OwnNotice[] {
  const root = NodePath.resolve(APP_DIR, "../..");
  const read = (file: string) =>
    NodeFS.readFileSync(NodePath.join(root, file), "utf8").replace(/\r\n/g, "\n").trim();
  return [
    {
      name: "SKYCOT",
      license: "Apache-2.0",
      sourceUrl: "https://github.com/mark-hallam/skycot-product",
      text: `Copyright (c) 2026 Curble Pty Ltd, trading as SKYCOT\n\n${read("LICENSE-APACHE")}`,
    },
    {
      name: "T3 Code (upstream project)",
      license: "MIT",
      sourceUrl: "https://github.com/pingdotgg/t3code",
      text: read("LICENSE"),
    },
  ];
}

export function buildNotices(): NoticeFile {
  const closure = collectDependencyClosure();
  const texts: Record<string, string> = {};
  const rows = [...closure.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, dir]) => {
      const pkg = readJson(NodePath.join(dir, "package.json"))!;
      return { pkg, license: licenceName(pkg), url: sourceUrl(pkg), found: licenceText(dir) };
    });
  // A package whose archive omits its licence file borrows the file of another package from the
  // same repository and licence (the @react-native/* family, the Expo packages).
  const byRepo = new Map<string, string>();
  for (const r of rows) {
    if (r.found !== null && r.url !== null) byRepo.set(`${r.url}|${r.license}`, r.found);
  }
  const packages: NoticePackage[] = rows.map(({ pkg, license, url, found }) => {
    const shared = found ?? (url === null ? null : (byRepo.get(`${url}|${license}`) ?? null));
    const body =
      shared ??
      `No licence file is included in this package. Its package.json declares the licence "${license}".${url === null ? "" : `\nSource: ${url}`}`;
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
    texts[hash] = body;
    return {
      name: pkg.name!,
      version: pkg.version ?? "0.0.0",
      license,
      sourceUrl: url,
      text: hash,
    };
  });
  return {
    schemaVersion: 1,
    own: ownNotices(),
    closureHash: closureHash(closure.keys()),
    packages,
    texts,
  };
}

const PERMISSIVE =
  /^(MIT|MIT-0|ISC|0BSD|BSD-2-Clause|BSD-3-Clause|BSD|Apache-2\.0|Apache 2\.0|Unlicense|CC0-1\.0|BlueOak-1\.0\.0|Python-2\.0|CC-BY-4\.0|CC-BY-3\.0|WTFPL)$/i;

/** An OR expression is fine when one alternative is permissive; every AND part must be. */
export function isPermissive(license: string): boolean {
  return license
    .replace(/[()]/g, " ")
    .split(/\s+OR\s+/i)
    .some((alt) => alt.split(/\s+AND\s+/i).every((p) => PERMISSIVE.test(p.trim())));
}
