// Per-browser preferences owned by Settings and onboarding. Same guarded
// storage pattern as state/preferences.ts: storage can be blocked, so reads
// fall back to defaults and writes fail silently.
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

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
    // The default applies next time.
  }
  for (const listener of listeners) listener();
}

export function useStoredString(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
}

export const ONBOARDING_KEY = "foreman:onboarding";
export type OnboardingState = "done" | "skipped" | null;

export function readOnboardingState(): OnboardingState {
  const raw = read(ONBOARDING_KEY);
  return raw === "done" || raw === "skipped" ? raw : null;
}
export function writeOnboardingState(state: OnboardingState) {
  write(ONBOARDING_KEY, state);
}
export function useOnboardingState(): OnboardingState {
  const raw = useStoredString(ONBOARDING_KEY);
  return raw === "done" || raw === "skipped" ? raw : null;
}

export const HANDS_OFF_MINUTES_KEY = "foreman:hands-off-minutes";

export function readHandsOffMinutes(fallback: number): number {
  const raw = read(HANDS_OFF_MINUTES_KEY);
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
export function writeHandsOffMinutes(minutes: number) {
  write(HANDS_OFF_MINUTES_KEY, String(minutes));
}
export function useHandsOffMinutes(fallback: number): number {
  const raw = useStoredString(HANDS_OFF_MINUTES_KEY);
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Appearance: the keys the stock UI and app/theme.ts already read.
const APPEARANCE_MODE_KEY = "t3code:theme-appearance-mode";
export type AppearanceMode = "system" | "light" | "dark";

export function useAppearanceMode(): AppearanceMode {
  const raw = useStoredString(APPEARANCE_MODE_KEY);
  return raw === "light" || raw === "dark" ? raw : "system";
}
export function writeAppearanceMode(mode: AppearanceMode) {
  write(APPEARANCE_MODE_KEY, mode === "system" ? null : mode);
}
