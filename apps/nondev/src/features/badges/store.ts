// This device's sticker book, as the engine last answered. One module-level snapshot (like
// the Family limits store), so the celebration, the sticker book and the watchers share it
// without a provider. Reports are de-duplicated here as well as on the engine: a conversation
// re-renders many times a second while it streams.
import type { BadgeEvent, BadgeId, BookView } from "@t3tools/skycot-rules/badges";
import { useSyncExternalStore } from "react";

import { badgesApi, type BadgeAnswer } from "./api";

export interface BadgesSnapshot {
  /** "loading" before the first answer; "ready" once the engine answered. */
  readonly status: "loading" | "ready" | "unavailable";
  readonly book: BookView | null;
}

let snapshot: BadgesSnapshot = { status: "loading", book: null };
const listeners = new Set<() => void>();
const reported = new Set<string>();

function set(next: BadgesSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const read = () => snapshot;

export function useBadges(): BadgesSnapshot {
  return useSyncExternalStore(subscribe, read, read);
}

function apply(answer: BadgeAnswer | null) {
  if (answer === null) {
    if (snapshot.status === "loading") set({ status: "unavailable", book: null });
    return;
  }
  // Another child's book: forget what was reported for the last one.
  if (answer.book?.childId !== snapshot.book?.childId) reported.clear();
  set({ status: "ready", book: answer.book });
}

export async function refreshBadges(): Promise<void> {
  apply(await badgesApi.book());
}

function keyOf(event: BadgeEvent): string {
  switch (event.type) {
    case "message":
      return `message:${event.messageId}`;
    case "made":
      return `made:${event.threadId}`;
    default:
      return event.type;
  }
}

/** Badges an event of this kind can only ever earn once, so a repeat need not travel. */
const ONE_MOMENT: Partial<Record<BadgeEvent["type"], BadgeId>> = {
  undo: "undo",
  voice: "voice",
};

function alreadyHas(id: BadgeId): boolean {
  return snapshot.book?.badges.some((badge) => badge.id === id && badge.earned !== null) ?? false;
}

/** Tell the engine what this device saw. Quiet on failure; the next sighting tries again. */
export async function reportBadgeEvent(event: BadgeEvent, projectId: string | null = null) {
  const key = keyOf(event);
  const only = ONE_MOMENT[event.type];
  if (reported.has(key) || (only !== undefined && alreadyHas(only))) return;
  reported.add(key);
  const answer = await badgesApi.record(event, projectId);
  if (answer === null) {
    reported.delete(key);
    return;
  }
  apply(answer);
}

/** The child saw these arrive. */
export async function markBadgesSeen(ids: ReadonlyArray<BadgeId>): Promise<void> {
  if (ids.length === 0) return;
  // Seen at once on this screen; the engine's answer confirms it.
  const book = snapshot.book;
  if (book !== null) {
    set({
      ...snapshot,
      book: {
        ...book,
        badges: book.badges.map((badge) =>
          ids.includes(badge.id) && badge.earned !== null
            ? { ...badge, earned: { ...badge.earned, seen: true } }
            : badge,
        ),
      },
    });
  }
  apply(await badgesApi.seen(ids));
}

/** Stickers earned but not yet seen arrive, in catalogue order. */
export function unseenBadges(book: BookView | null): ReadonlyArray<BadgeId> {
  return (book?.badges ?? [])
    .filter((badge) => badge.earned !== null && !badge.earned.seen)
    .map((badge) => badge.id);
}
