/**
 * Thin, synchronous git/shell helpers for the nondev fork tooling. Side effects live here;
 * pure logic lives in lib.ts.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  ENGINE_PACKAGES,
  type FileMap,
  type ImportUse,
  type Snapshot,
  extractImports,
} from "./lib.ts";

export interface RunResult {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  /** stdout followed by stderr, for log tails. */
  out: string;
}

export function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; input?: string },
): RunResult {
  const r = NodeChildProcess.spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    input: opts.input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const stdout = r.stdout ?? "";
  const stderr = r.error ? `${r.error.message}\n${r.stderr ?? ""}` : (r.stderr ?? "");
  return {
    ok: r.status === 0 && !r.error,
    status: r.status,
    stdout,
    stderr,
    out: `${stdout}${stderr}`,
  };
}

export class GitError extends Error {
  constructor(args: string[], result: RunResult) {
    super(`git ${args.join(" ")} failed (exit ${result.status}):\n${result.out.trim()}`);
  }
}

export function repoRoot(start = process.cwd()): string {
  const r = run("git", ["rev-parse", "--show-toplevel"], { cwd: start });
  if (!r.ok)
    throw new Error("Not inside a git repository. Run this from the t3code-nondev checkout.");
  return r.stdout.trim();
}

export function git(root: string, args: string[]): string {
  const r = run("git", args, { cwd: root });
  if (!r.ok) throw new GitError(args, r);
  return r.stdout.replace(/\n$/, "");
}

export function gitTry(root: string, args: string[]): string | null {
  const r = run("git", args, { cwd: root });
  return r.ok ? r.stdout.replace(/\n$/, "") : null;
}

export function gitLines(root: string, args: string[]): string[] {
  const out = git(root, args);
  return out === "" ? [] : out.split("\n");
}

export function hasRemote(root: string, name: string): boolean {
  return gitLines(root, ["remote"]).includes(name);
}

export function currentBranch(root: string): string | null {
  const b = gitTry(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return b === "" ? null : b;
}

export function branchExists(root: string, name: string): boolean {
  return gitTry(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]) !== null;
}

/** Porcelain status lines: tracked changes (staged or not) and untracked files. */
export function dirtyFiles(root: string): { tracked: string[]; untracked: string[] } {
  const lines = gitLines(root, ["status", "--porcelain", "--untracked-files=all"]);
  const tracked: string[] = [];
  const untracked: string[] = [];
  for (const l of lines) {
    const path = l.slice(3);
    if (l.startsWith("??")) untracked.push(path);
    else tracked.push(path);
  }
  return { tracked, untracked };
}

export function fileAt(root: string, rev: string, path: string): string | null {
  return gitTry(root, ["show", `${rev}:${path}`]);
}

export function packageVersionAt(
  root: string,
  rev: string,
  pkgJsonPath = "apps/desktop/package.json",
): string | null {
  const text = fileAt(root, rev, pkgJsonPath);
  if (!text) return null;
  try {
    const v = (JSON.parse(text) as { version?: unknown }).version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export function nearestTag(root: string, rev: string): string | null {
  return gitTry(root, ["describe", "--tags", "--abbrev=0", "--match", "v*", rev]);
}

/**
 * Loads every source file of the engine packages at `rev` into memory with one
 * `git cat-file --batch` call (hundreds of files; one process instead of hundreds).
 */
export function loadEngineSnapshot(root: string, rev: string): Snapshot {
  const dirs = ENGINE_PACKAGES.map((p) => p.dir);
  const paths = gitLines(root, ["ls-tree", "-r", "--name-only", rev, "--", ...dirs]).filter(
    (p) => /\.(ts|tsx)$/.test(p) || p.endsWith("/package.json"),
  );
  const files: FileMap = new Map();
  if (paths.length === 0) return { files };
  const r = NodeChildProcess.spawnSync("git", ["cat-file", "--batch"], {
    cwd: root,
    input: paths.map((p) => `${rev}:${p}`).join("\n") + "\n",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`git cat-file --batch failed: ${r.stderr?.toString() ?? ""}`);
  const buf: Buffer = r.stdout;
  let offset = 0;
  for (const p of paths) {
    const nl = buf.indexOf(0x0a, offset);
    if (nl < 0) break;
    const header = buf.subarray(offset, nl).toString("utf8");
    offset = nl + 1;
    if (header.endsWith(" missing")) continue;
    const size = Number(header.split(" ")[2]);
    files.set(p, buf.subarray(offset, offset + size).toString("utf8"));
    offset += size + 1; // trailing newline after content
  }
  return { files };
}

export function listFilesRecursive(dir: string, accept: (name: string) => boolean): string[] {
  if (!NodeFS.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of NodeFS.readdirSync(d)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
      const full = NodePath.join(d, entry);
      const st = NodeFS.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (accept(entry)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** Every `@t3tools/{contracts,client-runtime,shared}` import under apps/nondev/src on disk. */
export function scanOurImports(root: string, srcDir: string): ImportUse[] {
  const prefixes = ENGINE_PACKAGES.map((p) => p.name);
  const files = listFilesRecursive(
    NodePath.join(root, srcDir),
    (n) => /\.(ts|tsx|mts|cts)$/.test(n) && !/\.test\./.test(n),
  );
  const uses: ImportUse[] = [];
  for (const f of files) {
    uses.push(
      ...extractImports(NodeFS.readFileSync(f, "utf8"), (spec) =>
        prefixes.some((p) => spec === p || spec.startsWith(`${p}/`)),
      ),
    );
  }
  return uses;
}
