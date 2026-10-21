# Themes (`apps/nondev/src/themes`)

A theme is **data, never code**. It is a JSON file (`*.theme.json`) that sets the
`--fm-*` design tokens from `styles/apple.css` and flips a few "flavour" switches
that select pre-written CSS in `styles/flavours.css`. A theme can change how the
app looks; it cannot change what the app does.

Plain-English authoring guide: [`docs/nondev/THEMES.md`](../../../../docs/nondev/THEMES.md).

## Files

| File                                       | Role                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema.ts`                                | The format, as an Effect `Schema`. `parseTheme()` validates text or an object and returns plain-English problems. Imports only `effect`, so `scripts/validate-theme.ts` can load it from Node.                                                                     |
| `library/*.theme.json`                     | Built-ins: `classic` (today's Apple look, every token spelled out), `workshop` (Option C, hand-drawn, Sam and Mo), `paper` (Option B, ink on paper, serif), `night-ops` (Option D, navy glass).                                                                    |
| `library.ts`                               | Loads and re-validates the built-ins at import time.                                                                                                                                                                                                               |
| `apply.ts`                                 | `applyThemeToRoot(theme, mode, root)`: inline `--fm-*` properties for the active light/dark mode plus `data-theme` and `data-flavour-*` attributes on `<html>`. Pure over a small `ThemeRoot` for tests.                                                           |
| `store.ts`                                 | Persistence (`skycot:theme`, `skycot:themes:custom`, `skycot:theme:paint`), `useActiveTheme()`, `useThemes()`, `setActiveTheme()`, `previewTheme()`/`endPreview()`, `importTheme()`, `removeCustomTheme()`, and the mirror into the desktop app's client settings. |
| `useCrew.ts`                               | `useCrew()` → `{ named, builder, checker, characters, playful }` with neutral fallbacks (`CREW_NAME`).                                                                                                                                                             |
| `CrewAvatar.tsx`, `CrewName.tsx`           | The faces and names, flavour-aware.                                                                                                                                                                                                                                |
| `Confetti.tsx`                             | One-shot confetti for "It's live", gated on `motion: playful` and `prefers-reduced-motion`.                                                                                                                                                                        |
| `ThemeGallery.tsx`, `ThemeEditorSheet.tsx` | Settings → Appearance and onboarding "Pick a look".                                                                                                                                                                                                                |

## How a theme reaches the page

1. `app/theme.ts` decides light or dark (same keys as the stock UI) and calls
   `reapplyActiveTheme(mode)`.
2. `store.ts` resolves the active theme (stored id → built-in or custom → Classic)
   and calls `applyThemeToRoot`.
3. Tokens the theme does not set are **removed** from `<html>`, so the stylesheet's
   own values (Classic, mode-aware) show through. A theme may therefore be sparse.
4. `index.html` reads `skycot:theme:paint` before React mounts so the first paint is
   the theme's window colour, not white or black.

## Invariants worth keeping

- Token names are a closed list (`TOKEN_NAMES`). Layout tokens (title bar height,
  column widths) are deliberately not in it.
- Token values pass `tokenValueProblem`: no `url(`, `expression(`, `@import`,
  `javascript:`, `var(`, `<`, `;`, `{`, backslashes; at most 200 characters. The
  whole file is at most 64 KB. Unknown keys anywhere are rejected.
- Risk moments are marked `data-sober` (approval and error cards, the restore
  sheet, the Publish sheet while confirming "put it live"). `flavours.css` scopes
  every playful rule with `:not([data-sober] *)` or an explicit sober override, so
  those regions keep plain borders and sober colours in every theme.
- No continuously repainting animation. Confetti runs once with
  `animation-fill-mode: forwards`.
- Component code never hard-codes a colour or radius; it reads a token. The glyph
  gradients, `--fm-on-status`, `--fm-on-bubble-me`, `--fm-knob`, `--fm-code-bg`,
  `--fm-ink`, `--fm-marker*`, `--fm-paper-dot`, `--fm-sidebar-hover` and
  `--fm-font-label` exist so themes can reach every surface.

## Verifying

```sh
vp test run apps/nondev/src/themes
node apps/nondev/scripts/validate-theme.ts apps/nondev/src/themes/library/*.theme.json
```
