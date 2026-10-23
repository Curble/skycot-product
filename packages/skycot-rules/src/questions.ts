// "Just ask": a conversation without a project. The engine keeps one SKYCOT-managed space
// for them (`<SKYCOT home>/scratch`, T3's own Scratch project) and gives every question its
// own folder inside it, so nothing in a person's real folders is touched. These rules say
// where a question may work: its own folder only. A sibling's question next to it is
// "outside", the same as any other folder on the Mac. Shared by the engine (Family gate,
// policy reactor) and the plain client (the cards say what the engine decides).

/** What the plain client calls the space. */
export const QUESTIONS_LABEL = "Questions";

function normalize(path: string): string | null {
  const slashed = path.replace(/\\/g, "/");
  const absolute = slashed.startsWith("/");
  const parts: Array<string> = [];
  for (const part of slashed.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}

/** The same folder, however it is spelled (trailing slash, `.`, `..`). */
export function sameFolder(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = normalize(a);
  return left !== null && left === normalize(b);
}

/** True when `root` is the Questions space itself. */
export function isQuestionsSpace(
  folder: string | null | undefined,
  questionsRoot: string | null | undefined,
): boolean {
  return sameFolder(folder, questionsRoot);
}

/**
 * True for a folder strictly inside the Questions space (a question's own folder, or
 * something in it). `..` is resolved first, so `scratch/../Documents` is not inside.
 */
export function isInQuestionsSpace(
  path: string | null | undefined,
  questionsRoot: string | null | undefined,
): boolean {
  if (!path || !questionsRoot) return false;
  const target = normalize(path);
  const root = normalize(questionsRoot);
  if (target === null || root === null || !root.startsWith("/") || root === "/") return false;
  return target.startsWith(`${root}/`);
}

export interface WorkRoots {
  /** Where the conversation works: its own folder (or private copy). */
  readonly projectRoot: string | null;
  /** The project's folder, also inside. For a question it is the question's own folder. */
  readonly projectFolder: string | null;
}

/**
 * Where a conversation may work. An ordinary conversation: its private copy and its project's
 * folder. A question: its own folder only, so the rest of the space (other questions) counts
 * as outside, and nothing in it is "your real project".
 */
export function workRootsFor(input: {
  readonly projectFolder: string | null;
  readonly worktreePath: string | null;
  readonly questionsRoot: string | null | undefined;
}): WorkRoots {
  if (isQuestionsSpace(input.projectFolder, input.questionsRoot)) {
    const own = input.worktreePath ?? input.projectFolder;
    return { projectRoot: own, projectFolder: own };
  }
  return {
    projectRoot: input.worktreePath ?? input.projectFolder,
    projectFolder: input.projectFolder,
  };
}
