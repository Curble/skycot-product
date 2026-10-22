// Which conversation's preview is open, the things pointed at waiting in its message box, and
// a message the preview asks to put there ("Ask Sam to fix it"). Kept in memory for this tab:
// the preview is a view, and the engine stops a site nobody looks at.
import type { Pointer } from "@t3tools/skycot-rules/preview";
import { MAX_POINTERS } from "@t3tools/skycot-rules/preview";
import { useSyncExternalStore } from "react";

export interface PointerDraft {
  readonly id: string;
  readonly pointer: Pointer;
  /** T3's picker's picture of it, when it took one; shown on the chip only, never sent. */
  readonly picture: string | null;
}

interface State {
  readonly openThreadId: string | null;
  readonly pointers: ReadonlyMap<string, ReadonlyArray<PointerDraft>>;
  readonly composerText: ReadonlyMap<string, SuggestedMessage>;
}

export interface SuggestedMessage {
  readonly text: string;
  /** "replace" fills the box; "append" adds to what is already typed (the picker's own note). */
  readonly mode: "replace" | "append";
  readonly nonce: number;
}

let state: State = { openThreadId: null, pointers: new Map(), composerText: new Map() };
const listeners = new Set<() => void>();
let nonce = 0;

function update(next: State) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openPreview(threadId: string): void {
  if (state.openThreadId !== threadId) update({ ...state, openThreadId: threadId });
}

export function closePreview(): void {
  if (state.openThreadId !== null) update({ ...state, openThreadId: null });
}

export function usePreviewOpen(threadId: string | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => threadId !== null && state.openThreadId === threadId,
    () => false,
  );
}

const NO_POINTERS: ReadonlyArray<PointerDraft> = [];

export function usePointers(threadId: string): ReadonlyArray<PointerDraft> {
  return useSyncExternalStore(
    subscribe,
    () => state.pointers.get(threadId) ?? NO_POINTERS,
    () => NO_POINTERS,
  );
}

/** Adds a chip; the oldest goes when there are already as many as one message carries. */
export function addPointer(threadId: string, draft: PointerDraft): void {
  const pointers = new Map(state.pointers);
  pointers.set(threadId, [...(state.pointers.get(threadId) ?? []), draft].slice(-MAX_POINTERS));
  update({ ...state, pointers });
}

export function removePointer(threadId: string, id: string): void {
  const pointers = new Map(state.pointers);
  pointers.set(
    threadId,
    (state.pointers.get(threadId) ?? []).filter((draft) => draft.id !== id),
  );
  update({ ...state, pointers });
}

export function clearPointers(threadId: string): void {
  if (!state.pointers.has(threadId)) return;
  const pointers = new Map(state.pointers);
  pointers.delete(threadId);
  update({ ...state, pointers });
}

/** Puts words in the conversation's message box, ready for the person to read and send. */
export function suggestMessage(
  threadId: string,
  text: string,
  mode: SuggestedMessage["mode"],
): void {
  nonce += 1;
  const composerText = new Map(state.composerText);
  composerText.set(threadId, { text, mode, nonce });
  update({ ...state, composerText });
}

export function useSuggestedMessage(threadId: string): SuggestedMessage | null {
  return useSyncExternalStore(
    subscribe,
    () => state.composerText.get(threadId) ?? null,
    () => null,
  );
}
