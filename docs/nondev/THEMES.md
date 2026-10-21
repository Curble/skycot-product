# SKYCOT themes — how to make your own look

A **theme** changes how SKYCOT looks: colours, corners, shadows, the font used for
headings, whether cards look hand-drawn, and what your crew is called. A theme can
never change what SKYCOT _does_. Approvals, undo and "put it live" look plain and
calm in every theme, on purpose.

Themes are small text files you can share. SKYCOT ships with four:

| Theme         | Feel                                                                                    |
| ------------- | --------------------------------------------------------------------------------------- |
| **Classic**   | The Apple Messages look. Calm, clean, familiar.                                         |
| **Workshop**  | Playful, hand-drawn. Cream paper, marker pens, and a named crew: Sam builds, Mo checks. |
| **Paper**     | Warm paper and ink, serif headings, one vermilion accent.                               |
| **Night Ops** | Dark navy glass with cyan, mint, amber and coral status lights.                         |

## Picking a theme

Settings → Appearance → **Theme**. Hover a card to try it on for a moment; click
to keep it. Light and dark are a separate switch underneath, and every theme has
both sides.

The first time you open SKYCOT, the welcome steps include **Pick a look**.

## Sharing a theme

- **Export this theme** downloads `<id>.skycot-theme.json`.
- **Share** copies the same text to your clipboard.
- **Import a theme…** reads a file someone sent you. If anything is wrong with it,
  SKYCOT tells you in plain English and changes nothing.

Imported themes appear under **My themes**. **Remove** takes one away again.

## Making a theme without writing a file

**Duplicate and edit…** starts from the theme you are using, lets you change the
sixteen colours that matter most (for light and dark separately), pick a flavour,
and name your crew. The app behind the sheet changes live. **Save as new** keeps it
under My themes.

## The file, explained

```json
{
  "format": "skycot-theme/1",
  "id": "sunday-cafe",
  "name": "Sunday Café",
  "author": "Mark",
  "description": "Warm and quiet.",
  "version": "1",
  "tokens": {
    "light": { "--fm-bg-window": "#fff6e6", "--fm-accent": "#f26b4e" },
    "dark": { "--fm-bg-window": "#241e1a", "--fm-accent": "#ff8a6c" }
  },
  "flavour": {
    "borders": "sketch",
    "cards": "sticky",
    "labels": "handwritten",
    "avatars": "characters",
    "accentShape": "round",
    "motion": "playful"
  },
  "crew": {
    "builder": { "name": "Sam", "color": "#f26b4e", "emoji": "🔨" },
    "checker": { "name": "Mo", "color": "#3fa66f", "emoji": "🔍" }
  },
  "voice": "playful",
  "preview": { "bg": "#fff6e6", "surface": "#ffffff", "accent": "#f26b4e", "text": "#2b2420" }
}
```

| Key                             | What it is                                                                                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`                        | Always `"skycot-theme/1"`.                                                                                                                                                             |
| `id`                            | Lowercase letters, digits and dashes, e.g. `sunday-cafe`. Two themes with the same id replace each other. The built-in ids (`classic`, `workshop`, `paper`, `night-ops`) are reserved. |
| `name`, `author`, `description` | Shown on the theme's card. `author` and `description` are optional.                                                                                                                    |
| `version`                       | Any version like `1` or `1.2.0`.                                                                                                                                                       |
| `tokens.light`, `tokens.dark`   | The colours and sizes for each appearance. You only need the ones you want to change; anything you leave out stays as in Classic. The full list is below.                              |
| `flavour`                       | Six switches, each with fixed choices (below).                                                                                                                                         |
| `crew`                          | Optional. Name the builder and the checker and the app says "Sam needs your OK" and "Mo's quick check" instead of "Crew". Both need a `name` and a `color`; `emoji` is optional.       |
| `voice`                         | `"neutral"` or `"playful"`. Playful adds a little warmth to a few headlines ("It's live! 🎉").                                                                                         |
| `preview`                       | Four colours used to draw the theme's card in the gallery.                                                                                                                             |

### Flavour choices

| Switch        | Choices                          | Effect                                                                                                                                     |
| ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `borders`     | `clean`, `sketch`                | Sketch draws wobbly hand-drawn outlines with hard offset shadows.                                                                          |
| `cards`       | `flat`, `sticky`                 | Sticky turns tip cards into sticky notes with a strip of tape.                                                                             |
| `labels`      | `system`, `handwritten`, `serif` | The font for eyebrows and big headings only; body text keeps `--fm-font`. Handwritten adds marker underlines.                              |
| `avatars`     | `initials`, `characters`         | Characters draws the crew as sticker faces in their colours.                                                                               |
| `accentShape` | `round`, `soft`, `square`        | The corners of buttons, pills and chips.                                                                                                   |
| `motion`      | `calm`, `playful`                | Playful allows one-shot confetti on "It's live" (never when your Mac asks for reduced motion). Nothing animates continuously in any theme. |

### Token values

A token value is ordinary CSS: a colour (`#f26b4e`, `rgba(0,0,0,0.5)`), a length
(`12px`), a font list (`"Chalkboard SE", cursive`), a gradient or a shadow. For
safety a value may not contain `url(`, `expression(`, `@import`, `javascript:`,
`var(`, `<`, `;`, `{` or `}` and may be at most 200 characters. The whole file may be at
most 64 KB. Any key SKYCOT does not know is an error, so a typo is caught instead of
silently ignored.

### Every token

Fonts: `--fm-font` (body), `--fm-font-label` (eyebrows and headings), `--fm-mono`.

Backgrounds: `--fm-bg-window`, `--fm-bg-toolbar`, `--fm-bg-content`, `--fm-bg-card`,
`--fm-bg-fill`, `--fm-bg-fill-2`, `--fm-bg-field`, `--fm-bg-sidebar`, `--fm-bg-button`,
`--fm-bg-scrim`, `--fm-sidebar-hover`, `--fm-paper-dot` (dotted-paper texture; `transparent` for none).

Lines: `--fm-sep`, `--fm-sep-2`, `--fm-sidebar-line`, `--fm-button-line`, `--fm-ink` (the pen colour hand-drawn borders use).

Text: `--fm-label`, `--fm-label-2`, `--fm-label-3`, `--fm-label-4`.

Accent and status: `--fm-accent`, `--fm-accent-soft`, `--fm-on-accent`, `--fm-on-status`,
`--fm-green`, `--fm-green-soft`, `--fm-green-ink`, `--fm-orange`, `--fm-orange-soft`,
`--fm-orange-ink`, `--fm-red`, `--fm-red-soft`, `--fm-red-ink`, `--fm-provider`,
`--fm-marker`, `--fm-marker-soft`, `--fm-crew-builder`, `--fm-crew-checker`.

Bubbles and code: `--fm-bubble-me`, `--fm-on-bubble-me`, `--fm-bubble-crew`, `--fm-code-bg`,
`--fm-code-bg-me`, `--fm-knob`.

Glyph fills (card icons, Settings glyphs, avatars; a colour or a gradient): `--fm-glyph-blue`,
`--fm-glyph-green`, `--fm-glyph-orange`, `--fm-glyph-grey`, `--fm-glyph-red`,
`--fm-glyph-purple`, `--fm-glyph-crew`, `--fm-glyph-person`.

Corners: `--fm-radius-sm`, `--fm-radius`, `--fm-radius-md`, `--fm-radius-lg`, `--fm-radius-xl`,
`--fm-radius-2xl`, `--fm-radius-bubble`.

Shadows: `--fm-shadow-card`, `--fm-shadow-sheet`, `--fm-shadow-popover`, `--fm-shadow-button`,
`--fm-shadow-segment`.

The best way to learn the values is to read
`apps/nondev/src/themes/library/classic.theme.json` (the defaults) next to
`workshop.theme.json` (how far they can go).

## Checking a file before you share it

```sh
node apps/nondev/scripts/validate-theme.ts path/to/my.theme.json
```

It prints `OK` or the same plain-English problems the app would show.

## Contributing a theme to the community library

See `apps/nondev/themes-community/CONTRIBUTING-THEMES.md`.
