// "Just ask": a conversation without a project. The engine keeps SKYCOT-managed spaces for
// them inside `<SKYCOT home>/scratch` (T3's own Scratch folder) and gives every question its
// own folder in one of them, so nothing in a person's real folders is touched.
//
// The spaces (Just ask per child, 24 October 2026):
//   - `<scratch>` itself, T3's Scratch project: the shared space. With the Family profile off it
//     is the only one, as T3 has it. With the profile on it holds the questions asked before
//     each child had their own ("Earlier questions") and stays a grown-up's space: a child sees
//     only their own earlier questions in it, and starts no new ones there.
//   - `<scratch>/children/<childId>`: one child's own space, a project of its own, owned by that
//     child the same way their projects are. Whose it is follows from the folder itself, so a
//     reset activity file cannot hand it to a brother or sister.
//
// These rules also say where a question may work: its own folder only. A sibling's question is
// "outside", the same as any other folder on the Mac. Shared by the engine (Family gate,
// visibility, policy reactor) and the clients (labels, and the cards say what the engine decides).

/** What the plain client calls the space. */
export const QUESTIONS_LABEL = "Questions";

/** The shared space while the Family profile is on: questions from before each child had their own. */
export const EARLIER_QUESTIONS_LABEL = "Earlier questions";

/** The folder inside the Questions space that holds one space per child. */
export const CHILD_SPACES_FOLDER = "children";

/**
 * Who the shared space belongs to while the Family profile is on, in the engine's "who started
 * what": the grown-ups, never a child (not a child id, so no child ever matches it).
 */
export const SHARED_QUESTIONS_OWNER = "skycot:grown-ups";

/** A child's id as the Family profile makes them (`c` and hex digits); anything else is no child's. */
const CHILD_ID = /^c[0-9a-f]{6,32}$/;

/** Which Questions space a folder is, if it is one. */
export type QuestionsSpace =
  | { readonly kind: "shared" }
  | { readonly kind: "child"; readonly childId: string };

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

/** A child's own space: `<questionsRoot>/children/<childId>`; null for a root or id that can't be one. */
export function childQuestionsFolder(
  questionsRoot: string | null | undefined,
  childId: string,
): string | null {
  if (!questionsRoot || !CHILD_ID.test(childId)) return null;
  const root = normalize(questionsRoot);
  if (root === null || !root.startsWith("/") || root === "/") return null;
  return `${root}/${CHILD_SPACES_FOLDER}/${childId}`;
}

/**
 * Which space `folder` is: the shared one (the Questions root itself), a child's own
 * (`<root>/children/<childId>`), or null for every other folder, a question's own folder included.
 */
export function questionsSpaceOf(
  folder: string | null | undefined,
  questionsRoot: string | null | undefined,
): QuestionsSpace | null {
  if (!folder || !questionsRoot) return null;
  if (sameFolder(folder, questionsRoot)) return { kind: "shared" };
  const target = normalize(folder);
  const root = normalize(questionsRoot);
  if (target === null || root === null || !root.startsWith("/") || root === "/") return null;
  const prefix = `${root}/${CHILD_SPACES_FOLDER}/`;
  if (!target.startsWith(prefix)) return null;
  const childId = target.slice(prefix.length);
  return CHILD_ID.test(childId) ? { kind: "child", childId } : null;
}

/** True when `folder` is a Questions space itself: the shared one or a child's own. */
export function isQuestionsSpace(
  folder: string | null | undefined,
  questionsRoot: string | null | undefined,
): boolean {
  return questionsSpaceOf(folder, questionsRoot) !== null;
}

/**
 * Who each Questions space belongs to, for the engine's "who started what" while the Family
 * profile is on: a child's space is that child's, the shared one the grown-ups'. These answers
 * replace whatever was recorded for those projects (the shared space was once recorded as
 * whichever child asked first, which locked their brothers and sisters out of Just ask).
 */
export function questionsSpaceOwners(
  projects: ReadonlyArray<{ readonly projectId: string; readonly workspaceRoot: string }>,
  questionsRoot: string | null | undefined,
): Record<string, string> {
  const owners: Record<string, string> = {};
  for (const project of projects) {
    const space = questionsSpaceOf(project.workspaceRoot, questionsRoot);
    if (space === null) continue;
    owners[project.projectId] = space.kind === "child" ? space.childId : SHARED_QUESTIONS_OWNER;
  }
  return owners;
}

/**
 * Whether a child may start a new question in a space: their own only. A brother's or sister's
 * is theirs, and the shared space is the grown-ups' (a child's earlier questions there keep
 * working, but new ones go to the child's own space).
 */
export function childMayStartQuestionIn(childId: string, space: QuestionsSpace): boolean {
  return space.kind === "child" && space.childId === childId;
}

/** "Ava's questions". */
export function childQuestionsLabel(name: string): string {
  return `${name.trim()}'s questions`;
}

/**
 * What a space is called on a screen. A child's own device says "Questions" for their own; the
 * family's Mac and grown-ups' devices say whose it is. The shared space is "Questions" while it
 * is the only one (the Family profile off), else "Earlier questions".
 */
export function questionsSpaceLabel(
  space: QuestionsSpace,
  viewer: {
    /** A child's own device: the only child space it is sent is its own. */
    readonly childDevice: boolean;
    readonly familyOn: boolean;
    /** A child's name by id, when the profile knows it. */
    readonly nameOf: (childId: string) => string | null;
    /** What the engine titled the project (for a child the profile no longer knows). */
    readonly title?: string | null | undefined;
  },
): string {
  if (space.kind === "shared") return viewer.familyOn ? EARLIER_QUESTIONS_LABEL : QUESTIONS_LABEL;
  if (viewer.childDevice) return QUESTIONS_LABEL;
  const name = viewer.nameOf(space.childId);
  if (name !== null && name.trim().length > 0) return childQuestionsLabel(name);
  return viewer.title?.trim() || QUESTIONS_LABEL;
}

/**
 * True for a folder strictly inside the Questions space (a child's space, a question's own
 * folder, or something in it). `..` is resolved first, so `scratch/../Documents` is not inside.
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
 * folder. A question (in the shared space or a child's own): its own folder only, so the rest
 * of the space (other questions) counts as outside, and nothing in it is "your real project".
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
