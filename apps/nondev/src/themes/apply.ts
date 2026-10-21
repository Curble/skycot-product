// Puts a theme on the page: the active mode's tokens become inline custom
// properties on <html>, and the flavour switches become data attributes that
// styles/flavours.css keys off. Pure over a small `ThemeRoot` so tests can
// pass a fake element.
import { TOKEN_NAMES, type SkycotTheme, type ThemeTokens, type TokenName } from "./schema";

export type Mode = "light" | "dark";

export interface ThemeRoot {
  readonly style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): string;
  };
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export const FLAVOUR_ATTRIBUTES = {
  borders: "data-flavour-borders",
  cards: "data-flavour-cards",
  labels: "data-flavour-labels",
  avatars: "data-flavour-avatars",
  accentShape: "data-flavour-accent-shape",
  motion: "data-flavour-motion",
} as const;

export const THEME_ATTRIBUTE = "data-theme";

/** The tokens the page should carry for `mode`; names the theme leaves out fall back to the stylesheet. */
export function tokensFor(theme: SkycotTheme, mode: Mode): ReadonlyMap<TokenName, string> {
  const set: ThemeTokens = theme.tokens[mode];
  const out = new Map<TokenName, string>();
  for (const name of TOKEN_NAMES) {
    const value = set[name];
    if (value !== undefined) out.set(name, value);
  }
  return out;
}

export function applyThemeToRoot(theme: SkycotTheme, mode: Mode, root: ThemeRoot): void {
  const tokens = tokensFor(theme, mode);
  for (const name of TOKEN_NAMES) {
    const value = tokens.get(name);
    if (value === undefined) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
  root.setAttribute(THEME_ATTRIBUTE, theme.id);
  for (const key of Object.keys(FLAVOUR_ATTRIBUTES) as Array<keyof typeof FLAVOUR_ATTRIBUTES>) {
    root.setAttribute(FLAVOUR_ATTRIBUTES[key], theme.flavour[key]);
  }
  if (theme.crew) {
    root.style.setProperty("--fm-crew-builder", theme.crew.builder.color);
    root.style.setProperty("--fm-crew-checker", theme.crew.checker.color);
  }
}

/** Back to the stylesheet's own look (Classic) with no theme attributes at all. */
export function clearThemeFromRoot(root: ThemeRoot): void {
  for (const name of TOKEN_NAMES) root.style.removeProperty(name);
  root.removeAttribute(THEME_ATTRIBUTE);
  for (const attribute of Object.values(FLAVOUR_ATTRIBUTES)) root.removeAttribute(attribute);
}

/**
 * The colours index.html paints before React mounts and the ones the window
 * chrome (theme-color) shows, for each mode. Missing tokens fall back to the
 * Classic stylesheet values so the first paint never flashes white or black.
 */
export function paintColors(theme: SkycotTheme): {
  readonly light: { readonly window: string; readonly toolbar: string };
  readonly dark: { readonly window: string; readonly toolbar: string };
} {
  const pick = (mode: Mode, name: TokenName, fallback: string) =>
    theme.tokens[mode][name] ?? fallback;
  return {
    light: {
      window: pick("light", "--fm-bg-window", "#f5f5f7"),
      toolbar: pick("light", "--fm-bg-toolbar", "#f6f6f8"),
    },
    dark: {
      window: pick("dark", "--fm-bg-window", "#1e1e1e"),
      toolbar: pick("dark", "--fm-bg-toolbar", "#262628"),
    },
  };
}
