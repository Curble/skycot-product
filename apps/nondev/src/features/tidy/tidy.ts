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
