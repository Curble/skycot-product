// Putting a conversation away, bringing it back and renaming it: the plain rules, kept pure
// so they can be tested without the engine.
import { threadRuntimeCanArchive } from "@t3tools/client-runtime/state/models";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

/** Long enough for "Mia's dinosaur game with the jumping volcano", short enough for a magnet. */
export const MAX_TITLE_LENGTH = 80;

export type TitleCheck =
  | { readonly ok: true; readonly title: string }
  | { readonly ok: false; readonly reason: string };

/**
 * The name as it will be saved: runs of spaces and new lines become one space, and the ends
 * are trimmed. A name with nothing in it is refused rather than saved as blank.
 */
export function cleanTitle(raw: string): TitleCheck {
  const title = raw.replace(/\s+/g, " ").trim();
  if (title.length === 0) return { ok: false, reason: "Type a name first." };
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, reason: `Keep it to ${MAX_TITLE_LENGTH} letters or fewer.` };
  }
  return { ok: true, title };
}

/**
 * Why a conversation cannot be put away right now, or null when it can. The engine keeps
 * working on a conversation that is running, so the list would hide work in progress.
 */
export function putAwayBlocked(
  shell: Pick<EnvironmentThreadShell, "runtime">,
  crewName: string,
): string | null {
  return threadRuntimeCanArchive(shell.runtime)
    ? null
    : `${crewName} is still working. Wait until ${crewName} finishes, or press Stop.`;
}

/** Deleting waits for the same reason putting away does: the crew is still working on it. */
export const deleteBlocked = putAwayBlocked;

/** The quoted name in the sheet's title, short enough for one line on a phone. */
export function quotedName(title: string, max = 40): string {
  const name = title.replace(/\s+/g, " ").trim();
  if (name.length === 0) return "this conversation";
  return `“${name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name}”`;
}

export interface DeleteSheetCopy {
  readonly title: string;
  readonly goes: string;
  readonly stays: ReadonlyArray<string>;
  readonly alternative: string | null;
  readonly final: string;
  readonly button: string;
}

/**
 * What the delete sheet says. Deleting is the engine's `thread.delete`: the conversation, every
 * message, plan and picture sent in it, and its restore points go. The project's folder, its
 * files as they are now and its kept versions (Git history) are not touched. Stickers are
 * never taken away.
 */
export function deleteSheetCopy(input: {
  readonly title: string;
  readonly archived: boolean;
  /** The Family profile is on: the red button asks for the parent code first. */
  readonly family: boolean;
}): DeleteSheetCopy {
  return {
    title: `Delete ${quotedName(input.title)}?`,
    goes: "The conversation goes: every message, plan and picture in it, and its restore points.",
    stays: [
      "The project's files stay on this Mac as they are now, with their kept versions.",
      "A page it made stays in the project as a file. Its magnet comes off the fridge.",
      "Stickers stay. They are never taken away.",
    ],
    alternative: input.archived
      ? null
      : "To keep it but tidy the list, put it away instead. That can be undone.",
    final: input.family
      ? "This can't be undone, so a grown-up enters the parent code."
      : "This can't be undone.",
    button: input.family ? "Enter parent code…" : "Delete",
  };
}
