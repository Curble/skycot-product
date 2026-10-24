/**
 * "Open it" on a family note ("Ava made something. Have a look"): where on the phone the note's
 * conversation opens. The thing the child made, running inside SKYCOT, when the fridge has it
 * (a page the conversation made); otherwise the conversation itself, read only. Never anything
 * that isn't the note's own conversation.
 */
import type { FridgeItem } from "../../../nondev/src/features/fridge/fridge";
import { friendlyTitle } from "../../../nondev/src/plain/titles";
import type { StackRoutes } from "../app/routes";
import type { FamilyNote } from "./api";

export type NoteTarget =
  | { readonly name: "Page"; readonly params: StackRoutes["Page"] }
  | { readonly name: "Conversation"; readonly params: StackRoutes["Conversation"] };

export function shownNoteTarget(
  macId: string,
  note: Pick<FamilyNote, "kind" | "threadId" | "title">,
  fridge: ReadonlyArray<FridgeItem> | null,
): NoteTarget | null {
  if (note.kind !== "shown" || note.threadId === undefined || note.threadId.length === 0) {
    return null;
  }
  const threadId = note.threadId;
  const made = fridge?.find((item) => item.threadId === threadId && item.page.length > 0);
  if (made !== undefined) {
    return {
      name: "Page",
      params: { macId, threadId, page: made.page, title: friendlyTitle(made.title) },
    };
  }
  return {
    name: "Conversation",
    params: { macId, threadId, title: note.title ?? "Something they made", readOnly: true },
  };
}
