// "Just ask": a conversation without a project. The engine keeps them in its Questions spaces
// (T3's Scratch project, and with the Family profile on one space per child), each in a private
// folder of its own, so nothing in the person's own folders is touched. This file holds the pure
// decisions: which target the compose box starts in, what each space is called, where a
// question's row belongs once it became a project, and when "Make this a project" is offered.
import type { OrchestrationProjectShell } from "@t3tools/contracts";
import {
  QUESTIONS_LABEL,
  questionsSpaceLabel,
  questionsSpaceOf,
  sameFolder,
} from "@t3tools/skycot-rules/questions";

export { QUESTIONS_LABEL };

export const JUST_ASK_COPY = {
  choice: "Just ask",
  choiceHint: "No project needed",
  placeholder: "Ask anything…",
  foot: "Starts a question in its own private space",
  footPhone: "A question in its own private space",
  presence: "in its own private space",
  makeProject: "Make this a project",
  offer: (made: boolean) =>
    made
      ? "Want to keep what was made? Turn this question into a project with its own name."
      : "Turn this question into a project with its own name.",
  madeProject: (name: string) => `“${name}” is a project now.`,
} as const;

/** What these rules read of a project (`EnvironmentProject` fits). */
interface ProjectLike {
  readonly environmentId: string;
  readonly id: string;
  readonly workspaceRoot: string;
  readonly isScratch?: boolean | undefined;
  readonly createdAt?: string | undefined;
}

export const keyOf = (project: { readonly environmentId: string; readonly id: string }) =>
  `${project.environmentId}:${project.id}`;

/** Who is looking, for a space's name: a child's own device, and the children's names. */
export interface QuestionsViewer {
  readonly childDevice: boolean;
  readonly familyOn: boolean;
  readonly children: ReadonlyArray<{ readonly id: string; readonly name: string | null }>;
}

/**
 * Every Questions space in an engine's list, named for this viewer ("Questions" on a child's own
 * device, "Ava's questions" on the Mac and grown-ups' devices, "Earlier questions" for the
 * shared space while the profile is on) and marked as a Questions space (`isScratch`, which T3
 * sets for its own Scratch project only), so the compose box, the sidebar, the avatar and "Make
 * this a project" treat a child's space the same way. Null when nothing changes.
 */
export function labelQuestionsSpaces(
  projects: ReadonlyArray<OrchestrationProjectShell>,
  questionsRoot: string,
  viewer: QuestionsViewer,
): Array<OrchestrationProjectShell> | null {
  let changed = false;
  const named = projects.map((project) => {
    const space = questionsSpaceOf(project.workspaceRoot, questionsRoot);
    if (space === null) return project;
    const title = questionsSpaceLabel(space, {
      childDevice: viewer.childDevice,
      familyOn: viewer.familyOn,
      nameOf: (id) => viewer.children.find((child) => child.id === id)?.name ?? null,
      title: project.title,
    });
    if (space.kind === "shared" && title === project.title) return project;
    changed = true;
    // `isScratch` rides along: the client runtime spreads the engine's project into its own.
    return space.kind === "child"
      ? ({ ...project, title, isScratch: true } as OrchestrationProjectShell)
      : { ...project, title };
  });
  return changed ? named : null;
}

/** True for one of the engine's Questions spaces (T3's Scratch project, or a child's own). */
export function isQuestionsProject(
  project: { readonly isScratch?: boolean | undefined } | null,
): boolean {
  return project?.isScratch === true;
}

/** The person's own projects: everything but the Questions space. */
export function realProjects<P extends ProjectLike>(projects: ReadonlyArray<P>): ReadonlyArray<P> {
  return projects.filter((project) => !isQuestionsProject(project));
}

/** Where the compose box sends a new conversation. */
export type ComposeTarget<P> =
  | { readonly kind: "question" }
  | { readonly kind: "project"; readonly project: P };

/**
 * The compose box's starting choice, most specific first: what the person picked in it, the
 * sidebar's selection, the last one used, the only project there is; "Just ask" when there are
 * no projects yet. Null asks the person to choose rather than guess between several.
 *
 * `chosen` and `preferredKey` are `environmentId:projectId` keys, or "question".
 */
export function composeTargetFor<P extends ProjectLike>(input: {
  readonly projects: ReadonlyArray<P>;
  /** False when this Mac offers no Questions space (its data folder is inside a Git checkout). */
  readonly questionsAvailable: boolean;
  readonly chosen: string | null;
  readonly preferredKey: string | null;
  readonly last: { readonly environmentId: string; readonly projectId: string } | null;
  /** A child always starts in their newest owned project instead of a sibling's old choice. */
  readonly defaultToNewest?: boolean | undefined;
}): ComposeTarget<P> | null {
  const { projects, questionsAvailable } = input;
  const own = realProjects(projects).toSorted((left, right) =>
    (right.createdAt ?? "").localeCompare(left.createdAt ?? ""),
  );
  const question = questionsAvailable ? ({ kind: "question" } as const) : null;
  const byKey = (key: string | null): ComposeTarget<P> | null => {
    if (key === null) return null;
    if (key === QUESTION_KEY) return question;
    const project = projects.find((candidate) => keyOf(candidate) === key);
    if (project === undefined) return null;
    return isQuestionsProject(project) ? question : { kind: "project", project };
  };
  const last =
    input.last === null ? null : byKey(`${input.last.environmentId}:${input.last.projectId}`);
  return (
    byKey(input.chosen) ??
    byKey(input.preferredKey) ??
    last ??
    (own.length === 1 || (input.defaultToNewest === true && own.length > 0)
      ? { kind: "project", project: own[0]! }
      : null) ??
    (own.length === 0 ? question : null)
  );
}

export const QUESTION_KEY = "question";

/**
 * The project a conversation belongs with. A question whose folder became a project ("Make
 * this a project") is still the engine's Scratch conversation, but it now lives with that
 * project: its row, count and filter follow the new project.
 */
export function projectForConversation<P extends ProjectLike>(
  shell: { readonly worktreePath: string | null },
  own: P | null,
  projects: ReadonlyArray<P>,
): P | null {
  if (!isQuestionsProject(own) || shell.worktreePath === null) return own;
  return (
    projects.find(
      (project) =>
        !isQuestionsProject(project) &&
        project.environmentId === own!.environmentId &&
        sameFolder(project.workspaceRoot, shell.worktreePath),
    ) ?? own
  );
}

/** Whether a conversation can become a project, and why not when it can't. */
export function makeProjectOffer(input: {
  /** The conversation's own project, before `projectForConversation`. */
  readonly ownProject: { readonly isScratch?: boolean | undefined } | null;
  /** True once its folder is already a project. */
  readonly adopted: boolean;
  readonly worktreePath: string | null;
  readonly archived: boolean;
  readonly working: boolean;
}): "offer" | "working" | null {
  if (!isQuestionsProject(input.ownProject) || input.adopted) return null;
  if (input.worktreePath === null || input.archived) return null;
  return input.working ? "working" : "offer";
}

/** The new project's name from what was typed: trimmed, one line, not too long. */
export function projectNameFrom(text: string): string | null {
  const name = text.replace(/\s+/g, " ").trim().slice(0, 60).trim();
  return name.length === 0 ? null : name;
}

/** The suggested name: the conversation's title without "?" and without "Make a" style starts. */
export function suggestedProjectName(title: string): string {
  const cleaned = title
    .replace(/[?!.]+$/g, "")
    .replace(
      /^(please\s+)?(can you\s+|could you\s+)?(make|build|create|draw|write)\s+(me\s+)?(an?|the|my)\s+/i,
      "",
    )
    .trim();
  const name = projectNameFrom(cleaned) ?? projectNameFrom(title) ?? "My project";
  return name.charAt(0).toUpperCase() + name.slice(1);
}
