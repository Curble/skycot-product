// Keeps `html.dark` in step with the system appearance and the stock UI's
// theme keys after first paint (index.html handles first paint itself). The
// Appearance choice made here (the mode key) wins; the stock UI's theme name is
// only consulted when no mode was ever chosen, and otherwise the OS decides.
import { reapplyActiveTheme } from "../themes/store";

const THEME_KEY = "t3code:theme";
const APPEARANCE_MODE_KEY = "t3code:theme-appearance-mode";
const FOLLOW_SYSTEM_KEY = "t3code:theme-follow-system";

export type AppearanceMode = "system" | "light" | "dark";

export function resolveIsDark(prefersDark: boolean): boolean {
  let stored: string | null = null;
  let mode: string | null = null;
  try {
    stored = window.localStorage.getItem(THEME_KEY);
    mode = window.localStorage.getItem(APPEARANCE_MODE_KEY);
  } catch {
    // Storage blocked: follow the system.
  }
  if (mode === "dark") return true;
  if (mode === "light") return false;
  if (mode === "system") return prefersDark;
  if (stored === "dark") return true;
  if (stored === "light") return false;
  return prefersDark;
}

export function readAppearanceMode(): AppearanceMode {
  try {
    const raw = window.localStorage.getItem(APPEARANCE_MODE_KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    // Storage blocked.
  }
  return "system";
}

/**
 * Writes every key the stock UI reads, so the two clients never disagree: the
 * mode key (what we read first), the theme name (what the stock UI applies)
 * and its follow-system flag.
 */
export function writeAppearanceMode(mode: AppearanceMode) {
  try {
    window.localStorage.setItem(APPEARANCE_MODE_KEY, mode);
    window.localStorage.setItem(THEME_KEY, mode);
    window.localStorage.setItem(FOLLOW_SYSTEM_KEY, mode === "system" ? "true" : "false");
  } catch {
    // The default applies next time.
  }
  // Same-tab writes do not fire `storage`; repaint now.
  applyTheme(resolveIsDark(window.matchMedia("(prefers-color-scheme: dark)").matches));
  window.dispatchEvent(new Event("skycot:appearance"));
}

export function applyTheme(isDark: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
  // The active theme owns the tokens, the window colour and theme-color for this mode.
  reapplyActiveTheme(isDark ? "dark" : "light");
}

export function startThemeSync(): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const update = () => applyTheme(resolveIsDark(media.matches));
  update();
  media.addEventListener("change", update);
  window.addEventListener("storage", update);
  return () => {
    media.removeEventListener("change", update);
    window.removeEventListener("storage", update);
  };
}
