// The last successful upload per thread. The engine does not keep a push log,
// so the client remembers when it last sent the draft line up; the strip pill
// and the Publish sheet read it so a person can tell whether they already sent
// their work. Storage can be blocked: every access is guarded.
import type { ThreadId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

export interface UploadRecord {
  /** ISO-8601 */
  readonly at: string;
  readonly branch: string | null;
}

const KEY_PREFIX = "skycot:last-upload:";
const listeners = new Set<() => void>();
const cache = new Map<string, UploadRecord | null>();

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

export function readLastUpload(threadId: ThreadId): UploadRecord | null {
  const key = `${KEY_PREFIX}${threadId}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let parsed: UploadRecord | null = null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) {
      const value: unknown = JSON.parse(raw);
      if (
        typeof value === "object" &&
        value !== null &&
        typeof (value as UploadRecord).at === "string"
      ) {
        parsed = {
          at: (value as UploadRecord).at,
          branch:
            typeof (value as UploadRecord).branch === "string"
              ? (value as UploadRecord).branch
              : null,
        };
      }
    }
  } catch {
    parsed = null;
  }
  cache.set(key, parsed);
  return parsed;
}

export function rememberUpload(threadId: ThreadId, record: UploadRecord): void {
  const key = `${KEY_PREFIX}${threadId}`;
  cache.set(key, record);
  try {
    window.localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Storage blocked: the in-memory copy still serves this session.
  }
  notify();
}

export function useLastUpload(threadId: ThreadId): UploadRecord | null {
  return useSyncExternalStore(
    subscribe,
    () => readLastUpload(threadId),
    () => null,
  );
}
