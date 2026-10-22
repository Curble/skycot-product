// "Peek at the code": the few lines a turn changed, picked from the turn's unified diff for a
// child to look at. Not a code review: at most a handful of lines, changes first, with one
// line around them so the change has a place to sit.

export type PeekLineKind = "added" | "removed" | "same";

export interface PeekLine {
  readonly kind: PeekLineKind;
  readonly text: string;
}

export interface PeekFile {
  readonly path: string;
  readonly lines: ReadonlyArray<PeekLine & { readonly key: number }>;
}

export interface Peek {
  readonly files: ReadonlyArray<PeekFile>;
  /** Changed lines left out to stay short. */
  readonly moreLines: number;
  /** Files with changes that were not shown at all. */
  readonly moreFiles: number;
}

/** Lock files and pictures say nothing to a child. */
const QUIET_FILES =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$|\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|map)$/i;

const MAX_LINE = 120;

function clip(text: string): string {
  return text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 1)}…` : text;
}

interface RawFile {
  path: string;
  lines: Array<PeekLine>;
}

function parseFiles(diff: string): Array<RawFile> {
  const files: Array<RawFile> = [];
  let current: RawFile | null = null;
  let inHunk = false;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const match = / b\/(.+)$/.exec(line);
      current = { path: match?.[1] ?? line.slice(11), lines: [] };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (current === null) continue;
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).replace(/^b\//, "");
      if (path !== "/dev/null") current.path = path;
      continue;
    }
    if (line.startsWith("--- ")) continue;
    if (line.startsWith("@@")) {
      // A gap between hunks reads as a break, not as lines that touch.
      if (inHunk && current.lines.length > 0) current.lines.push({ kind: "same", text: "…" });
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("\\")) continue;
    const mark = line[0];
    const text = clip(line.slice(1));
    if (mark === "+") current.lines.push({ kind: "added", text });
    else if (mark === "-") current.lines.push({ kind: "removed", text });
    else current.lines.push({ kind: "same", text });
  }
  return files;
}

/** The changed lines with one unchanged line either side, gaps shown as "…". */
function aroundChanges(lines: ReadonlyArray<PeekLine>): Array<PeekLine> {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    for (const near of [index - 1, index, index + 1]) {
      if (near >= 0 && near < lines.length) keep.add(near);
    }
  });
  const out: Array<PeekLine> = [];
  let last = -2;
  for (const index of [...keep].sort((a, b) => a - b)) {
    if (index > last + 1 && out.length > 0) out.push({ kind: "same", text: "…" });
    const line = lines[index]!;
    if (!(line.kind === "same" && line.text === "…" && out.at(-1)?.text === "…")) out.push(line);
    last = index;
  }
  return out.filter((line) => !(line.kind === "same" && line.text.trim().length === 0));
}

/** Up to `maxLines` lines across the turn's files, changes first. */
export function peekAtCode(diff: string, maxLines = 20): Peek {
  const files = parseFiles(diff).filter(
    (file) => !QUIET_FILES.test(file.path) && file.lines.some((line) => line.kind !== "same"),
  );
  const shown: Array<PeekFile> = [];
  let budget = maxLines;
  let moreLines = 0;
  let moreFiles = 0;
  for (const file of files) {
    const lines = aroundChanges(file.lines);
    const changed = lines.filter((line) => line.kind !== "same").length;
    if (budget <= 0) {
      moreFiles += 1;
      moreLines += changed;
      continue;
    }
    const taken = lines.slice(0, budget);
    moreLines += changed - taken.filter((line) => line.kind !== "same").length;
    budget -= taken.length;
    shown.push({ path: file.path, lines: taken.map((line, key) => ({ ...line, key })) });
  }
  return { files: shown, moreLines, moreFiles };
}
