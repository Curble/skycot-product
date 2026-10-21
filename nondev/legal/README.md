# nondev/legal — compliance seams the fork needs

The analysis, attribution text, privacy notes and go-live checklist are in `docs/legal/`. This
folder records the **engineering changes to upstream files** that the licensing work needs. Each
one is a small appended change in the style of the existing `// nondev-seam:` markers and has a
row in `SEAM-MANIFEST.md` ("Legal and security seams").

**Status, 21 October 2026:** L-1, L-2 and L-5 are applied (see each section). L-3 is the only
one still open — it lives in `apps/nondev/` and `apps/web/vite.config.ts`, which this pass did not
own. L-4 is closed by a stronger measure than the one proposed here: the engine's own default is
now off (`telemetry-default-off`), and `nondev/bin/skycot.cjs` is the supported CLI entry.

## Seam L-1: ship `LICENSE` and `NOTICE` inside the desktop bundle

**Applied** (seam `L-1`, both spots, `scripts/build-desktop-artifact.ts`). The `.deb` copyright path (item 3) is left as upstream has it.

**Why.** MIT requires the notice "in all copies or substantial portions of the Software". The
desktop build stages a fresh directory (`stageAppDir`) with a synthesized `package.json`
(`"license": "MIT"` is metadata, not the notice) and copies only `patches/`. Only the Linux `.deb`
gets the licence file (`/usr/share/doc/t3code/copyright`). macOS and Windows installers therefore
contain the text nowhere except inside the SKYCOT client's JavaScript (the About pane). A visible
file beside the app is the conventional, defensible form.

**Change (scripts/build-desktop-artifact.ts, two spots).**

1. Where `patches/` is copied into the staged app (search for
   `fs.copy(path.join(repoRoot, "patches")`), add after it:

   ```ts
   // nondev-seam: L-1 — MIT notice must travel with every copy of the app.
   for (const noticeFile of ["LICENSE", "NOTICE"]) {
     yield * fs.copy(path.join(repoRoot, noticeFile), path.join(stageAppDir, noticeFile));
   }
   ```

2. In `DESKTOP_EXTRA_RESOURCES`, add two entries so the files land at
   `Contents/Resources/LICENSE` and `Contents/Resources/NOTICE` (Windows: `resources/`):

   ```ts
   { from: "LICENSE", to: "LICENSE" }, // nondev-seam: L-1
   { from: "NOTICE", to: "NOTICE" }, // nondev-seam: L-1
   ```

   `from` is relative to the staged project directory, which step 1 populates. Upstream's
   behaviour is unchanged for them only if `NOTICE` exists in their tree; if this is ever offered
   upstream, guard the `NOTICE` copy with an existence check.

3. Optional, cosmetic: the `.deb` path `/usr/share/doc/t3code/copyright` should use the brand's
   `cliName` when the Linux artefact is built for SKYCOT.

See `proposed-license-packaging.diff` for the same change as a reviewable diff (illustrative; line
numbers drift with upstream, apply by hand).

## Seam L-2: `LICENSE` and `NOTICE` in the CLI archive and npm launcher

**Applied** (seams `L-2a` in `scripts/build-cli-archive.ts`, `L-2b` in `scripts/build-npm-launcher.ts`; the npm `files` list names both files, and a scratch build of the launcher showed them in the tarball).

`scripts/build-cli-archive.ts` and `scripts/build-npm-launcher.ts` package the server binary and
launcher without a licence file (`build-npm-launcher.ts` only copies the `license` field). Add the
two files to each archive the same way. Until then, the npm package metadata says MIT but ships no
notice text.

## Seam L-3: make the licence pipeline aware of `apps/nondev`

**Open — needs the conductor** (`apps/web/vite.config.ts` and `apps/nondev/package.json` are outside this pass's ownership). One line; see below.

`apps/web/vite.config.ts` lists the root manifests the third-party-notice generator walks (`web`,
`server`, `desktop`). Add:

```ts
{ bundle: "web", path: new URL("../nondev/package.json", import.meta.url) }, // nondev-seam: L-3
```

Today every SKYCOT dependency is also a web/server/desktop dependency, so nothing is missing; the
line stops a future SKYCOT-only library from shipping without its notice. The generator fails the
strict build on a missing notice, which is the behaviour we want.

## Seam L-4: analytics can never fall back to upstream's PostHog

**Closed by a stronger measure**: seam `telemetry-default-off` in `AnalyticsService.ts` makes the engine default to off even when `env.cjs` is not loaded (env override still works; pinned by `telemetry-default-off-test`), and `nondev/bin/skycot.cjs` is the supported CLI entry point. The release smoke test below still applies.

`apps/server/src/telemetry/AnalyticsService.ts` defaults to enabled with T3's key and
`https://ingest.t3.codes`. `nondev/brand/env.cjs` turns it off, but only when loaded. Every SKYCOT
entry point must load it: the desktop does (`boot.ts`); the CLI archive and npm launcher must spawn
with `--import ./nondev/brand/env.cjs` (or set the three `T3CODE_TELEMETRY_*`/`T3CODE_POSTHOG_*`
variables at build time). Release smoke test: run the packaged CLI on a clean machine with a
network capture and confirm no request to `ingest.t3.codes`.

## Seam L-5: CLI self-update feed

**Applied** as seam `brand-cli-update-repo`, reading `T3CODE_CLI_UPDATE_REPOSITORY` (set by `env.cjs` to `brand.updateRepository`, which `apply-brand.ts` requires to equal the git origin, `mark-hallam/skycot-product`). It covers both the `update` command's release index and the default download base URL.

`packages/shared/src/cliRelease.ts` hard-codes `pingdotgg/t3code` as the release repository for
the `update` command. A SKYCOT CLI would update itself into T3's binary. Read the repository from
`T3CODE_DESKTOP_UPDATE_REPOSITORY` (already env-driven for the desktop) with upstream's value as
the default, in the usual `process.env.X ?? "pingdotgg/t3code"` seam form.

## Checking

- `git diff upstream/main --stat -- LICENSE` must stay empty forever.
- After L-1 lands: open the built `.app`, `Contents/Resources/LICENSE` and `NOTICE` exist and the
  `LICENSE` text equals the repository's.
- `node nondev/scripts/apply-brand.ts` keeps failing on any `.env` containing upstream's Clerk key
  or relay host.
