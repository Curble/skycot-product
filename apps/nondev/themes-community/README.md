# Community themes for SKYCOT

This folder is where themes made by people outside the core team live. Each theme
is one `*.theme.json` file in the `skycot-theme/1` format described in
[`docs/nondev/THEMES.md`](../../../docs/nondev/THEMES.md).

Anyone can import a theme file from here through **Settings → Appearance → Import a
theme…**, and anyone can send one in. Themes are data: they change colours, corners
and words, never behaviour, so they are safe to try.

## Layout

```
themes-community/
  README.md
  CONTRIBUTING-THEMES.md
  <id>.theme.json        one file per theme, named after its "id"
```

## Validating everything in this folder

```sh
node apps/nondev/scripts/validate-theme.ts apps/nondev/themes-community/*.theme.json
```

The same script runs over the built-in library in CI, so a theme that passes here
is one the app will accept.
