// "Kept versions" are the commits made from this app's Keep button. The engine
// has no commit-log RPC, so the client remembers them per thread in
// localStorage; the Versions rail merges them with the engine's checkpoints.
// Storage can be blocked, so every access is guarded and an empty list wins.
import type { ThreadId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import type { KeptVersion } from "../../plain/versions";

export interface KeptVersionRecord extends KeptVersion {
  /** The checkpoint the kept files came from, when Keep ran from a What-changed card. */
  readonly checkpointId?: string;
}

const KEY_PREFIX = "skycot:kept-versions:";
const EMPTY: ReadonlyArray<KeptVersionRecord> = [];

const listeners = new Set<() => void>();
const cache = new Map<string, ReadonlyArray<KeptVersionRecord>>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(KEY_PREFIX)) {
      cache.clear();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function isRecord(value: unknown): value is KeptVersionRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as KeptVersionRecord).sha === "string" &&
    typeof (value as KeptVersionRecord).subject === "string" &&
    typeof (value as KeptVersionRecord).at === "string"
  );
}

export function readKeptVersions(threadId: ThreadId): ReadonlyArray<KeptVersionRecord> {
  const key = `${KEY_PREFIX}${threadId}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let parsed: ReadonlyArray<KeptVersionRecord> = EMPTY;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) parsed = value.filter(isRecord);
    }
  } catch {
    parsed = EMPTY;
  }
  cache.set(key, parsed);
  return parsed;
}

export function rememberKeptVersion(threadId: ThreadId, version: KeptVersionRecord): void {
  const key = `${KEY_PREFIX}${threadId}`;
  const existing = readKeptVersions(threadId).filter((entry) => entry.sha !== version.sha);
  const next = [...existing, version];
  cache.set(key, next);
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage blocked: the in-memory copy still serves this session.
  }
  notify();
}

export function useKeptVersions(threadId: ThreadId): ReadonlyArray<KeptVersionRecord> {
  return useSyncExternalStore(
    subscribe,
    () => readKeptVersions(threadId),
    () => EMPTY,
  );
}
