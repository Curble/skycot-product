# Canonical attribution text

Use these exact wordings. "SKYCOT" is the product and a registered business name of Curble Pty Ltd,
the company that owns and sells it (confirmed by Mark, 22 October 2026).

## One line (website footer, download page, app store "about" field)

> SKYCOT is based on T3 Code, © T3 Tools Inc., used under the MIT License. SKYCOT is not
> affiliated with or endorsed by T3 Tools Inc.

Link "T3 Code" to https://github.com/pingdotgg/t3code and "MIT License" to the licence text
(the `LICENSE` file, or the About pane in the app).

## About box / installer (desktop, "About SKYCOT" panel, README badge area)

```
SKYCOT <version>
© 2026 Curble Pty Ltd, trading as SKYCOT, Melbourne, Australia · www.skycot.com

Based on T3 Code · © T3 Tools Inc. · MIT License
https://github.com/pingdotgg/t3code

"T3" and "T3 Code" are names of T3 Tools Inc. SKYCOT is an independent product and is not
affiliated with or endorsed by T3 Tools Inc. The full MIT License text is in LICENSE; third-party
open-source notices are under Settings > About > Open-source licences.
```

## README (top of the fork's README; full section draft in README-section.md)

> **SKYCOT is a fork of [T3 Code](https://github.com/pingdotgg/t3code)** by T3 Tools Inc., used
> under the [MIT License](./LICENSE). The upstream copyright notice and licence are preserved in
> `LICENSE` and `NOTICE`. SKYCOT is not affiliated with or endorsed by T3 Tools Inc.

## In-app (already implemented, `apps/nondev/src/features/settings/panes/AboutPane.tsx`)

- Row: **Based on T3 Code** — "© T3 Tools Inc. · MIT licence · read the full text" → sheet with
  the `LICENSE` text bundled at build time and a button to the upstream repository.
- Row: **Open-source licences** — sheet listing every third-party component from the build-time
  manifest, with search and full notice text.
- Group footer: states the engine, connectors and developer interface are T3 Code's, that "T3" and
  "T3 Code" are names of T3 Tools Inc., and the non-affiliation disclaimer.

## Rules

1. Never shorten to "powered by T3" or put T3's name in the product name, domain, app id, URL
   scheme, or app-store title/keywords.
2. Never use T3's logo, icon, DMG background or marketing artwork.
3. Always keep the non-affiliation sentence next to the attribution.
4. Do not edit `LICENSE`. New SKYCOT-only source files may carry a SKYCOT copyright header, but
   files derived from upstream keep upstream's notice.
