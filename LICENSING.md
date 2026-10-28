# Licensing: what is under which licence

SKYCOT is two things stacked together, and each has its own licence.

## 1. T3 Code: MIT License

SKYCOT is built on [T3 Code](https://github.com/pingdotgg/t3code), by T3 Tools Inc.
Everything that came from upstream stays under the **MIT License**, exactly as T3
published it. That text is the file [`LICENSE`](./LICENSE), unchanged. This covers
the engine, the provider connectors, the developer interface ("Advanced mode") and
every other file we inherited. [`SEAM-MANIFEST.md`](./SEAM-MANIFEST.md) lists the
few places where we touched an upstream file.

## 2. Curble's additions: Apache License 2.0

What Curble Pty Ltd (trading as SKYCOT) wrote is under the **Apache License,
Version 2.0**. The text is [`LICENSE-APACHE`](./LICENSE-APACHE). This covers:

- `apps/nondev` (the SKYCOT client) and `apps/skycot-mobile` (the iPhone and iPad app)
- `packages/skycot-*` and `infra/skycot-*`
- `nondev/` (the branding layer, scripts and the brand generator)
- the `native/*` folders that are Curble's own work
- the documentation Curble wrote, including `docs/nondev` and the website source

## Files that carry both

A few upstream files have small SKYCOT seams added. In those files the original
lines are MIT (T3 Tools Inc.) and the lines Curble added are Apache-2.0. Each seam
is listed in `SEAM-MANIFEST.md`.

## Names and characters are not licensed

The **SKYCOT name, the logo, and the cloud and crew characters** are trademarks and
copyright of Curble Pty Ltd. Neither licence gives you any right to use them. The
Apache License says so itself (section 6: no permission to use the trade names,
trademarks or product names of the licensor). If you fork SKYCOT, use your own name
and artwork. "T3" and "T3 Code" are names of T3 Tools Inc.

## How to give credit

If you copy or redistribute any part of this repository:

1. Keep `LICENSE` (MIT), `LICENSE-APACHE` and `NOTICE` with it.
2. Keep the copyright lines in the files you copy.
3. Say what you changed in files you modified (Apache-2.0 section 4).
4. Credit "SKYCOT by Curble Pty Ltd" for the additions and "T3 Code by T3 Tools Inc."
   for the base.

This page is a plain-English guide, not legal advice. If it and the licence texts
ever disagree, the licence texts win.
