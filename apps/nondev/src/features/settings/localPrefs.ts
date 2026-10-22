// Per-browser preferences owned by Settings and onboarding. Same guarded
// storage pattern as state/preferences.ts: storage can be blocked, so reads
// fall back to defaults and writes fail silently.
import { useSyncExternalStore } from "react";

import {
  type AppearanceMode,
  writeAppearanceMode as writeThemeAppearanceMode,
} from "../../app/theme";
import {
  MASCOT_OVERRIDE_KEY,
  parseMascotOverride,
  type MascotOverride,
} from "../../plain/daylight";

const listeners = new Set<() => void>();

export function subscribeLocalPrefs(listener: () => void) {
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
    subscribeLocalPrefs,
    () => read(key),
    () => null,
  );
}

export const ONBOARDING_KEY = "skycot:onboarding";
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

// The "hands-off timer" preference was removed (SEC-02): nothing on the server ever read it,
// so the promise it made was false. A real time-box must live server-side.
// Appearance: app/theme.ts owns the keys (ours and the stock UI's); this is the
// React view of the mode key.
const APPEARANCE_MODE_KEY = "t3code:theme-appearance-mode";
export type { AppearanceMode } from "../../app/theme";

export function useAppearanceMode(): AppearanceMode {
  const raw = useStoredString(APPEARANCE_MODE_KEY);
  return raw === "light" || raw === "dark" ? raw : "system";
}
export function writeAppearanceMode(mode: AppearanceMode) {
  writeThemeAppearanceMode(mode);
  for (const listener of listeners) listener();
}

// Larger text: one attribute on <html> (`data-text="large"`) that styles/apple.css
// turns into a 1.12 `--fm-text-scale`. Default on for Family profiles; anyone can switch it.
export const TEXT_SIZE_KEY = "skycot:text";
export type TextSize = "normal" | "large";

export function readTextSize(): TextSize {
  return read(TEXT_SIZE_KEY) === "large" ? "large" : "normal";
}
export function applyTextSize(size: TextSize) {
  if (size === "large") document.documentElement.setAttribute("data-text", "large");
  else document.documentElement.removeAttribute("data-text");
}
export function writeTextSize(size: TextSize) {
  write(TEXT_SIZE_KEY, size === "large" ? "large" : null);
  applyTextSize(size);
}
export function useTextSize(): TextSize {
  return useStoredString(TEXT_SIZE_KEY) === "large" ? "large" : "normal";
}

// Mascot: follow the sky (no key), or always one drawing. Only the in-app mascot and the tab
// icon read it; the desktop Dock icon always follows the sky (apps/desktop/src/skycot/dockIcon.ts).
export function readMascotOverride(): MascotOverride {
  return parseMascotOverride(read(MASCOT_OVERRIDE_KEY));
}
export function writeMascotOverride(override: MascotOverride) {
  write(MASCOT_OVERRIDE_KEY, override);
}
export function useMascotOverride(): MascotOverride {
  return parseMascotOverride(useStoredString(MASCOT_OVERRIDE_KEY));
}
