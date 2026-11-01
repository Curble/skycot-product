// Which earlier message is being changed in each conversation's reply box. Kept in memory for
// this tab: nothing goes back until the person sends the changed message and says yes.
import type { RunId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

export interface EditDraft {
  /** The turn item of the message being changed. */
  readonly itemId: string;
  readonly runId: RunId;
  /** What goes back in the box. */
  readonly text: string;
  /** Pictures the message carried: they don't come back with the words. */
  readonly pictures: number;
  /** Things pointed at in the preview: they don't come back either. */
  readonly pointedAt: number;
  /** Changes on every Edit press, so pressing Edit again refills the box. */
  readonly nonce: number;
}

let drafts: ReadonlyMap<string, EditDraft> = new Map();
let nonce = 0;
const listeners = new Set<() => void>();

function update(next: ReadonlyMap<string, EditDraft>) {
  drafts = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startEditing(threadId: string, draft: Omit<EditDraft, "nonce">): void {
  nonce += 1;
  update(new Map(drafts).set(threadId, { ...draft, nonce }));
}

export function stopEditing(threadId: string): void {
  if (!drafts.has(threadId)) return;
  const next = new Map(drafts);
  next.delete(threadId);
  update(next);
}

export function useEditDraft(threadId: string): EditDraft | null {
  return useSyncExternalStore(
    subscribe,
    () => drafts.get(threadId) ?? null,
    () => null,
  );
}

/**
 * A press of Edit on a message, waiting for the conversation's rewind host to check it (the
 * bubble does no work of its own: a long conversation has many of them).
 */
export interface EditRequest {
  readonly itemId: string;
  readonly nonce: number;
}

let requests: ReadonlyMap<string, EditRequest> = new Map();

export function askToEdit(threadId: string, itemId: string): void {
  nonce += 1;
  requests = new Map(requests).set(threadId, { itemId, nonce });
  for (const listener of listeners) listener();
}

export function useEditRequest(threadId: string): EditRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => requests.get(threadId) ?? null,
    () => null,
  );
}

export function clearEditRequest(threadId: string): void {
  if (!requests.has(threadId)) return;
  const next = new Map(requests);
  next.delete(threadId);
  requests = next;
  for (const listener of listeners) listener();
}

/**
 * Words from a taken-back message, waiting to be added to a conversation's message box. The
 * box adds them after what is already typed, once per nonce.
 */
export interface PutBack {
  readonly text: string;
  readonly nonce: number;
}

let putBacks: ReadonlyMap<string, PutBack> = new Map();

export function putBackInBox(threadId: string, text: string): void {
  nonce += 1;
  putBacks = new Map(putBacks).set(threadId, { text, nonce });
  for (const listener of listeners) listener();
}

export function usePutBack(threadId: string): PutBack | null {
  return useSyncExternalStore(
    subscribe,
    () => putBacks.get(threadId) ?? null,
    () => null,
  );
}
