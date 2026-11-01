// Notes on single lines of the code changes, waiting for the next message of one conversation.
// A grown-up taps a changed line, writes what should change there, and the note rides with the
// next message as plain words ("Notes on the code: ..."). Kept in memory for this tab: a note is
// a draft, not a record, so it needs no storage and nothing on the engine. A note that has not
// been sent is simply gone when the app closes.
import { useSyncExternalStore } from "react";

export interface LineNote {
  readonly id: string;
  /** The changed file's path, as the diff shows it. */
  readonly path: string;
  readonly line: number;
  /** A line the change took out has its number in the old version of the file. */
  readonly removed: boolean;
  readonly note: string;
}

/** A note is a short pointer, not an essay; and one message only carries so many. */
export const NOTE_MAX_LENGTH = 400;
export const MAX_LINE_NOTES = 10;

const NO_NOTES: ReadonlyArray<LineNote> = [];

let notes: ReadonlyMap<string, ReadonlyArray<LineNote>> = new Map();
const listeners = new Set<() => void>();

function update(next: ReadonlyMap<string, ReadonlyArray<LineNote>>) {
  notes = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLineNotes(threadId: string): ReadonlyArray<LineNote> {
  return useSyncExternalStore(
    subscribe,
    () => notes.get(threadId) ?? NO_NOTES,
    () => NO_NOTES,
  );
}

/** Adds a note; the oldest goes when there are already as many as one message carries. */
export function addLineNote(threadId: string, note: LineNote): void {
  const next = new Map(notes);
  next.set(threadId, [...(notes.get(threadId) ?? []), note].slice(-MAX_LINE_NOTES));
  update(next);
}

export function removeLineNote(threadId: string, id: string): void {
  const next = new Map(notes);
  next.set(
    threadId,
    (notes.get(threadId) ?? []).filter((note) => note.id !== id),
  );
  update(next);
}

export function clearLineNotes(threadId: string): void {
  if (!notes.has(threadId)) return;
  const next = new Map(notes);
  next.delete(threadId);
  update(next);
}

/** The last part of a path: what the chip calls the file. */
export function fileNameOf(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX_LENGTH);
}

/**
 * The notes as a plain-text block ahead of what was typed. With no notes the message is
 * unchanged; with notes and no typed words the block is the whole message.
 */
export function withLineNotes(text: string, lineNotes: ReadonlyArray<LineNote>): string {
  if (lineNotes.length === 0) return text;
  const lines = lineNotes
    .slice(0, MAX_LINE_NOTES)
    .map(
      (entry) =>
        `- ${entry.path} line ${entry.line}${entry.removed ? " (a line that was taken out)" : ""}: ${oneLine(entry.note)}`,
    );
  const block = ["Notes on the code:", ...lines].join("\n");
  const typed = text.trim();
  return typed.length === 0 ? block : `${block}\n\n${typed}`;
}
