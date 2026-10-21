// Small per-browser preferences. Storage can be blocked (private windows,
// locked-down profiles), so every access is guarded and the defaults win.
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import type { Autonomy } from "../features/compose/autonomy";

const LAST_PROJECT_KEY = "foreman:last-project";
const AUTONOMY_KEY = "foreman:autonomy";

export interface ProjectRef {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the default applies next time.
  }
  notify();
}

export function readLastProject(): ProjectRef | null {
  const raw = read(LAST_PROJECT_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as ProjectRef).environmentId === "string" &&
      typeof (parsed as ProjectRef).projectId === "string"
    ) {
      return parsed as ProjectRef;
    }
  } catch {
    // Corrupt value: fall through to the default.
  }
  return null;
}

export function writeLastProject(ref: ProjectRef | null) {
  write(LAST_PROJECT_KEY, ref === null ? null : JSON.stringify(ref));
}

export function useLastProject(): ProjectRef | null {
  return useSyncExternalStore(subscribe, readLastProjectSnapshot, () => null);
}
// useSyncExternalStore needs a stable snapshot; cache by raw string.
let lastRaw: string | null = null;
let lastValue: ProjectRef | null = null;
function readLastProjectSnapshot(): ProjectRef | null {
  const raw = read(LAST_PROJECT_KEY);
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastValue = readLastProject();
  }
  return lastValue;
}

const AUTONOMY_VALUES: ReadonlySet<string> = new Set<Autonomy>([
  "ask-first",
  "carefully",
  "hands-off",
]);

export function readAutonomy(): Autonomy {
  const raw = read(AUTONOMY_KEY);
  return raw !== null && AUTONOMY_VALUES.has(raw) ? (raw as Autonomy) : "ask-first";
}

export function writeAutonomy(value: Autonomy) {
  write(AUTONOMY_KEY, value);
}
