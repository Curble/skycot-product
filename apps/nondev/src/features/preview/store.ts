// Which conversation's preview is open (and which of its pages "Open it" asked for), the things
// pointed at waiting in its message box, and a message the preview asks to put there ("Ask Sam
// to fix it"). Kept in memory for this tab: the preview is a view, and the engine stops a site
// nobody looks at.
import type { EnvironmentId } from "@t3tools/contracts";
import type { Pointer, PreviewProblem } from "@t3tools/skycot-rules/preview";
import { MAX_POINTERS } from "@t3tools/skycot-rules/preview";
import { useSyncExternalStore } from "react";

export interface PointerDraft {
  readonly id: string;
  readonly pointer: Pointer;
  /** T3's picker's picture of it, when it took one; shown on the chip only, never sent. */
  readonly picture: string | null;
}

/** "Open it" asked the Preview for one page of the site; a new ask has a new `nonce`. */
export interface PageRequest {
  readonly path: string;
  readonly nonce: number;
}

/** A preview opened from outside its conversation (the fridge, a recap): shown as a sheet. */
export interface PreviewElsewhere {
  readonly threadId: string;
  readonly environmentId: EnvironmentId;
}

interface State {
  readonly openThreadId: string | null;
  readonly page: PageRequest | null;
  /** Where the open preview belongs, when it was opened by "Open it" from anywhere. */
  readonly environmentId: EnvironmentId | null;
  readonly pointers: ReadonlyMap<string, ReadonlyArray<PointerDraft>>;
  readonly composerText: ReadonlyMap<string, SuggestedMessage>;
}

export interface SuggestedMessage {
  readonly text: string;
  /** "replace" fills the box; "append" adds to what is already typed (the picker's own note). */
  readonly mode: "replace" | "append";
  readonly nonce: number;
  /**
   * A child's "Ask Sam to fix it": the command and output the child does not see, sent as
   * hidden context with the message while the child's words are still that message.
   */
  readonly problem?: PreviewProblem;
}

let state: State = {
  openThreadId: null,
  page: null,
  environmentId: null,
  pointers: new Map(),
  composerText: new Map(),
};
const listeners = new Set<() => void>();
let nonce = 0;

export function shouldClosePreviewOnRouteChange(
  previous: { readonly name: string; readonly threadId?: string | null },
  next: { readonly name: string; readonly threadId?: string | null },
): boolean {
  return (
    (previous.name === "thread" &&
      (next.name !== "thread" || next.threadId !== previous.threadId)) ||
    (previous.name !== next.name && next.name !== "thread")
  );
}

function update(next: State) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The Preview button: the site as it starts (its own first page). */
export function openPreview(threadId: string): void {
  if (state.openThreadId !== threadId || state.page !== null) {
    update({ ...state, openThreadId: threadId, page: null, environmentId: null });
  }
}

/** "Open it": the conversation's Preview, at one page of its site. */
export function openPreviewAt(threadId: string, environmentId: EnvironmentId, path: string): void {
  nonce += 1;
  update({ ...state, openThreadId: threadId, page: { path, nonce }, environmentId });
}

export function closePreview(): void {
  if (state.openThreadId !== null) {
    update({ ...state, openThreadId: null, page: null, environmentId: null });
  }
}

/** The page "Open it" asked this conversation's Preview for, if it did. */
export function usePreviewPage(threadId: string): PageRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => (state.openThreadId === threadId ? state.page : null),
    () => null,
  );
}

let elsewhere: PreviewElsewhere | null = null;

/**
 * The preview "Open it" opened for a conversation other than `shownThreadId` (the one on
 * screen, which shows its own preview beside it), or null.
 */
export function usePreviewElsewhere(shownThreadId: string | null): PreviewElsewhere | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      const { openThreadId, environmentId } = state;
      if (openThreadId === null || environmentId === null || openThreadId === shownThreadId) {
        return null;
      }
      // One object per open preview, so React sees the same answer until it changes.
      if (elsewhere?.threadId !== openThreadId || elsewhere.environmentId !== environmentId) {
        elsewhere = { threadId: openThreadId, environmentId };
      }
      return elsewhere;
    },
    () => null,
  );
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
  problem?: PreviewProblem,
): void {
  nonce += 1;
  const composerText = new Map(state.composerText);
  composerText.set(threadId, { text, mode, nonce, ...(problem ? { problem } : {}) });
  update({ ...state, composerText });
}

export function useSuggestedMessage(threadId: string): SuggestedMessage | null {
  return useSyncExternalStore(
    subscribe,
    () => state.composerText.get(threadId) ?? null,
    () => null,
  );
}
