// Which theme is on, and the ones the person imported or made. Both live in
// this browser's localStorage (guarded: storage can be blocked) and the active
// id is mirrored into the desktop app's client settings when that bridge exists.
import type { ClientSettings } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { applyThemeToRoot, paintColors, type Mode } from "./apply";
import { BUILT_IN_THEMES, CLASSIC_THEME, CLASSIC_THEME_ID, isBuiltInThemeId } from "./library";
import { parseTheme, type SkycotTheme } from "./schema";

export const ACTIVE_THEME_KEY = "skycot:theme";
export const CUSTOM_THEMES_KEY = "skycot:themes:custom";
/** `{ light: { window, toolbar }, dark: {…} }` for index.html's first paint. */
export const PAINT_KEY = "skycot:theme:paint";

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
    // Storage blocked: the choice lasts for this page only.
  }
}

// useSyncExternalStore wants referentially stable snapshots; cache by raw text.
let customRaw: string | null | undefined;
let customCache: ReadonlyArray<SkycotTheme> = [];

export function readCustomThemes(): ReadonlyArray<SkycotTheme> {
  const raw = read(CUSTOM_THEMES_KEY);
  if (raw === customRaw) return customCache;
  customRaw = raw;
  customCache = [];
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        customCache = parsed.flatMap((entry) => {
          const result = parseTheme(entry);
          return result.ok && !isBuiltInThemeId(result.theme.id) ? [result.theme] : [];
        });
      }
    } catch {
      // Corrupt storage: start with no custom themes rather than failing to boot.
    }
  }
  return customCache;
}

function writeCustomThemes(themes: ReadonlyArray<SkycotTheme>) {
  write(CUSTOM_THEMES_KEY, themes.length === 0 ? null : JSON.stringify(themes));
  notify();
}

export function readActiveThemeId(): string {
  return read(ACTIVE_THEME_KEY) ?? CLASSIC_THEME_ID;
}

export function allThemes(): ReadonlyArray<SkycotTheme> {
  return [...BUILT_IN_THEMES, ...readCustomThemes()];
}

export function themeById(id: string): SkycotTheme | null {
  return allThemes().find((theme) => theme.id === id) ?? null;
}

/** The theme in force: the stored choice when it still exists, else Classic. */
export function readActiveTheme(): SkycotTheme {
  return themeById(readActiveThemeId()) ?? CLASSIC_THEME;
}

let previewing: SkycotTheme | null = null;

export function useActiveTheme(): SkycotTheme {
  return useSyncExternalStore(subscribe, readActiveTheme, () => CLASSIC_THEME);
}

/** The theme on the page right now: a hover/focus/editor preview when there is one, else the stored choice. */
export function readShownTheme(): SkycotTheme {
  return previewing ?? readActiveTheme();
}

/** For copy that should follow a preview too (crew names, "the Paper look"), not only the saved choice. */
export function useShownTheme(): SkycotTheme {
  return useSyncExternalStore(subscribe, readShownTheme, () => CLASSIC_THEME);
}

export function useThemes(): ReadonlyArray<SkycotTheme> {
  const custom = useSyncExternalStore(subscribe, readCustomThemes, () => customCache);
  return custom.length === 0 ? BUILT_IN_THEMES : [...BUILT_IN_THEMES, ...custom];
}

function currentMode(): Mode {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function paint(theme: SkycotTheme, mode: Mode) {
  const colors = paintColors(theme)[mode];
  const root = document.documentElement;
  root.style.backgroundColor = colors.window;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = colors.toolbar;
}

/** Puts `theme` on the page for the current mode without changing the stored choice. */
function show(theme: SkycotTheme, mode: Mode = currentMode()) {
  applyThemeToRoot(theme, mode, document.documentElement);
  paint(theme, mode);
}

/** Called by app/theme.ts after every light/dark change and at startup. */
export function reapplyActiveTheme(mode: Mode): void {
  const theme = previewing ?? readActiveTheme();
  show(theme, mode);
  write(PAINT_KEY, JSON.stringify(paintColors(readActiveTheme())));
}

export function setActiveTheme(id: string): void {
  const theme = themeById(id) ?? CLASSIC_THEME;
  write(ACTIVE_THEME_KEY, theme.id === CLASSIC_THEME_ID ? null : theme.id);
  previewing = null;
  reapplyActiveTheme(currentMode());
  notify();
  void mirrorToDesktop(theme.id);
}

/** Try a theme on for a moment; `endPreview` puts the real one back. */
export function previewTheme(theme: SkycotTheme): void {
  previewing = theme;
  show(theme);
  notify();
}

export function endPreview(): void {
  if (previewing === null) return;
  previewing = null;
  show(readActiveTheme());
  notify();
}

export type ImportOutcome =
  | { readonly ok: true; readonly theme: SkycotTheme; readonly replaced: boolean }
  | { readonly ok: false; readonly problems: ReadonlyArray<string> };

/** Validate and keep a theme under "My themes". A built-in id cannot be shadowed. */
export function importTheme(input: unknown): ImportOutcome {
  const result = parseTheme(input);
  if (!result.ok) return result;
  const theme = result.theme;
  if (isBuiltInThemeId(theme.id)) {
    return {
      ok: false,
      problems: [
        `"${theme.id}" is the id of a built-in theme. Change the "id" to something of your own.`,
      ],
    };
  }
  const existing = readCustomThemes();
  const replaced = existing.some((entry) => entry.id === theme.id);
  writeCustomThemes([...existing.filter((entry) => entry.id !== theme.id), theme]);
  return { ok: true, theme, replaced };
}

export function removeCustomTheme(id: string): void {
  writeCustomThemes(readCustomThemes().filter((theme) => theme.id !== id));
  if (readActiveThemeId() === id) setActiveTheme(CLASSIC_THEME_ID);
}

/**
 * The desktop app keeps client settings on disk; mirror the active id there
 * so a reinstall or a second window agrees. The settings schema ignores keys
 * it does not know, so this is harmless where the field does not exist yet.
 */
async function mirrorToDesktop(id: string): Promise<void> {
  const bridge = window.desktopBridge;
  if (!bridge?.setClientSettings) return;
  try {
    const current = (await bridge.getClientSettings()) ?? null;
    if (current === null) return;
    const next = { ...current, skycotTheme: id } as ClientSettings & { skycotTheme: string };
    await bridge.setClientSettings(next);
  } catch {
    // Best effort only; localStorage is the source of truth.
  }
}
