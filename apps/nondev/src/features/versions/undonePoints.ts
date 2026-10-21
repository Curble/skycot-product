// Undone restore points the engine has since pruned. After a restore the engine
// marks later points "stale", and drops them on the next turn; the rail would
// then lose the "undone" row and hand its version number to the next change.
// The client remembers each undone point once it sees it (per thread, in
// localStorage, every access guarded) so the row and its number stay put.
import type { ThreadId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import type { VersionEntry } from "../../plain/versions";

export interface UndonePoint {
  readonly id: string;
  readonly label: string;
  /** ISO-8601 */
  readonly timestamp: string;
  readonly fileCount: number;
  readonly technical: string;
}

const KEY_PREFIX = "skycot:undone-points:";
const EMPTY: ReadonlyArray<UndonePoint> = [];
const listeners = new Set<() => void>();
const cache = new Map<string, ReadonlyArray<UndonePoint>>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isPoint(value: unknown): value is UndonePoint {
  const point = value as UndonePoint;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof point.id === "string" &&
    typeof point.label === "string" &&
    typeof point.timestamp === "string" &&
    typeof point.fileCount === "number" &&
    typeof point.technical === "string"
  );
}

export function readUndonePoints(threadId: ThreadId): ReadonlyArray<UndonePoint> {
  const key = `${KEY_PREFIX}${threadId}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let parsed: ReadonlyArray<UndonePoint> = EMPTY;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) parsed = value.filter(isPoint);
    }
  } catch {
    parsed = EMPTY;
  }
  cache.set(key, parsed);
  return parsed;
}

/** Adds the points not yet remembered; a no-op (no notify) when nothing is new. */
export function rememberUndonePoints(threadId: ThreadId, points: ReadonlyArray<UndonePoint>) {
  const existing = readUndonePoints(threadId);
  const known = new Set(existing.map((point) => point.id));
  const fresh = points.filter((point) => !known.has(point.id));
  if (fresh.length === 0) return;
  const key = `${KEY_PREFIX}${threadId}`;
  const next = [...existing, ...fresh];
  cache.set(key, next);
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage blocked: the in-memory copy still serves this session.
  }
  for (const listener of listeners) listener();
}

export function useUndonePoints(threadId: ThreadId): ReadonlyArray<UndonePoint> {
  return useSyncExternalStore(
    subscribe,
    () => readUndonePoints(threadId),
    () => EMPTY,
  );
}

export function undonePointOf(entry: VersionEntry): UndonePoint {
  return {
    id: entry.id,
    label: entry.label,
    timestamp: entry.timestamp,
    fileCount: entry.fileCount,
    technical: entry.technical,
  };
}
