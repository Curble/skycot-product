# Contributing a theme

Thank you. A good community theme is one you would be happy to use all week, in
light and in dark, on a laptop and on a phone.

## 1. Author it

The easiest start is inside the app: **Settings → Appearance → Duplicate and
edit…**, then **Export this theme**. Open the exported file and tidy it:

- `id`: lowercase letters, digits and dashes (`sunset-bakery`). Not one of the
  built-in ids. Name the file `<id>.theme.json`.
- `name`, `author`, `description`: what people will read on the card. Keep
  `description` to one short sentence.
- `version`: start at `1`.
- Fill **both** `tokens.light` and `tokens.dark`. You may leave tokens out; anything
  missing stays as in Classic for that mode, which is fine for a sparse theme but
  looks odd when a theme is dark in one mode and half-Classic in the other.
- `preview` should match what the theme really looks like in light mode.

The format, every token and every flavour choice are in
[`docs/nondev/THEMES.md`](../../../docs/nondev/THEMES.md).

## 2. Validate it

```sh
node apps/nondev/scripts/validate-theme.ts apps/nondev/themes-community/<id>.theme.json
```

Fix anything it reports. The messages are the same ones the app shows on import.

## 3. Look at it

Import the file in the app and check:

- Home, a conversation with cards, Settings and the Publish sheet, in light and
  dark.
- Text on the accent (`--fm-on-accent`) and on status colours (`--fm-on-status`)
  is readable.
- An approval card still looks plain and serious. That is by design; do not try
  to decorate it.

## 4. Send it

Open a pull request that adds the one file. In the description, paste two
screenshots (light and dark) and one sentence about who the theme is for. Please
do not change any other file in the same pull request.

## Rules

- One theme per pull request.
- No fonts, images or links. A theme is colours, lengths, font _names_ and words.
  The validator rejects `url(` and friends.
- Keep the crew names kind and short. They appear in sentences like "Sam needs
  your OK".
- Themes carry your `author` name only if you want it there.

## Licence and ownership

- By opening a pull request you offer your theme under the **Apache License 2.0**
  (the same licence as the rest of SKYCOT's own work; see `LICENSING.md`).
- You confirm that you made the theme yourself, or that you have the right to
  share it, and that it is yours to give.
- A theme must not use third-party names: no brand, product, game, film or
  character names in the `id`, `name`, `description` or crew names, and no
  imitation of someone else's look under their name.
- The SKYCOT name, logo and characters are not licensed to you by contributing.
