# Brand assets for the fork

Plain-language note: an **asset** is a picture file the app or installer shows (app icon, favicon,
installer background). Upstream (T3 Code) keeps its artwork in three brand sets: `dev` (the blue
"blueprint" look used while developing), `nightly` and `prod`. Our desktop build uses the **`prod`**
set unless the version string has a `-nightly.` suffix, which ours never does.

This folder holds the fork's identity:

- `../brand.json` — names and identifiers (single source of truth; placeholder values until the CEO
  picks the final name).
- `env.cjs` — turns `brand.json` into `T3CODE_*` environment defaults at process start. Loaded by
  `apps/desktop/src/boot.ts` (seam `brand-boot`), and via `node --import ./nondev/brand/env.cjs …`
  for the build script and the CLI. See `node nondev/scripts/apply-brand.ts` for the full table.
- This README — which image files must be replaced and how upstream's scripts regenerate them.

Nothing in this folder designs icons. Replacing the files below is a human/designer task.

## 1. Files to replace (exact paths, sizes, where they are used)

All paths are relative to the repository root. Replace **in place**, keeping the file names, so
`scripts/lib/brand-assets.ts` (`BRAND_ASSET_PATHS`) and `apps/desktop/src/app/DesktopAssets.ts`
need no edit. Declare the replaced tree in `SEAM-MANIFEST.md` as a `(binary)` glob row, e.g.
`assets/prod/**`, so the nightly sync keeps ours on conflict.

### Desktop app icons (shipped in the installer)

| File                                   | Size / format                                                                    | Used by                                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets/prod/app-icon.icon`            | Icon Composer 2 project (folder; `text.svg` + `background.svg` + layers)         | **Source of truth** for every export below (`vp run icons:export`).                                                                                     |
| `assets/prod/black-macos-1024.png`     | 1024×1024 PNG, RGBA. Classic macOS safe area: 824×824 body inset 100 px per side | macOS `.icns` (built by `scripts/build-desktop-artifact.ts` via `iconutil`), DMG icon, Dock icon in unpackaged runs (`DesktopAssets.ts` `prod.macPng`). |
| `assets/prod/black-universal-1024.png` | 1024×1024 PNG, RGBA, full bleed                                                  | Linux icon set (`icons/` in the staged build) and the Dock/taskbar icon on Linux in unpackaged runs (`prod.universalPng`).                              |
| `assets/prod/t3-black-windows.ico`     | ICO containing 16, 24, 32, 48, 64, 128, 256 px PNG frames (`WINDOWS_ICON_SIZES`) | Windows `icon.ico` (installer + taskbar) and `prod.ico` in unpackaged runs.                                                                             |
| `assets/prod/black-ios-1024.png`       | 1024×1024 PNG                                                                    | Mobile app icon (`apps/mobile`, not shipped by us). Keep a copy so `vp run icons:check` stays green.                                                    |

### Web favicons (copied over the stock client's favicons in `apps/server/dist/client`)

`scripts/build-desktop-artifact.ts` calls `applyWebBrandAssets("production", "apps/server/dist/client")`
after the server bundle is built, which overwrites four files in the hosted web output:

| Source file                                    | Size           | Written to                                     |
| ---------------------------------------------- | -------------- | ---------------------------------------------- |
| `assets/prod/t3-black-web-favicon.ico`         | multi-size ICO | `apps/server/dist/client/favicon.ico`          |
| `assets/prod/t3-black-web-favicon-16x16.png`   | 16×16 PNG      | `apps/server/dist/client/favicon-16x16.png`    |
| `assets/prod/t3-black-web-favicon-32x32.png`   | 32×32 PNG      | `apps/server/dist/client/favicon-32x32.png`    |
| `assets/prod/t3-black-web-apple-touch-180.png` | 180×180 PNG    | `apps/server/dist/client/apple-touch-icon.png` |

Our own client at `apps/nondev` ships its own `public/` favicons; those are not touched by this step
and are the nondev team's responsibility.

### Development look (optional, only affects `vp run dev` / unpackaged runs)

`assets/dev/blueprint-*.{png,ico}` (same sizes as the `prod` set) and `assets/dev/app-icon.icon`.
Leaving these as upstream's blueprint icons is harmless: packaged builds never use them.

### Installer artwork and strings

| File                                                           | What it is                                                                                                         | Replace?                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `apps/desktop/resources/dmg/dmg-background-latest.svg`         | macOS DMG window background (SVG; electron-builder rasterises it)                                                  | Yes, before the first public macOS build. Keep the file name.              |
| `apps/desktop/resources/dmg/dmg-background-nightly.svg`        | Same, for nightly builds                                                                                           | Not needed (we never build `-nightly.`).                                   |
| `apps/desktop/resources/installer.nsh`                         | Windows NSIS installer script fragment (353 bytes)                                                                 | Check for "T3 Code" strings before a Windows build.                        |
| `apps/desktop/resources/linux/com.t3tools.t3code.metainfo.xml` | Linux AppStream metadata; the file name is tied to the upstream app id in `scripts/build-desktop-artifact.ts:2986` | Linux is not a launch target. Needs a new file + a 1-line seam when it is. |
| `assets/prod/logo.svg`                                         | Wordmark used by the marketing site                                                                                | Not shipped by us.                                                         |

### Strings that still say "T3 Code" in the desktop shell (cosmetic, not identifiers)

These are left as upstream wrote them because they are not identifiers and a placeholder name
should not spread into a 4,000-line file. Revisit once the final name is chosen:

- `scripts/build-desktop-artifact.ts` mac `extendInfo` usage descriptions (camera, microphone,
  screen capture, local network prompts begin with "T3 Code …"), the protocol display `name:
"T3 Code"`, Linux `executableName`/`StartupWMClass: "t3code"`, `maintainer`, `synopsis`.
- `apps/desktop/src/window/DesktopApplicationMenu.ts:77` "T3 Code <version> is currently the
  newest version available." (the menus themselves use `environment.displayName`, so they already
  say Foreman).
- `apps/desktop/src/app/DesktopEnvironment.ts` / `DesktopEarlyElectronStartup.ts` `linuxWmClass`
  (Linux only), and Linux-only cache/data subfolders named `t3code` under XDG dirs.
- Server-side strings ("T3 Code server is ready.", MCP tool descriptions, generated READMEs) are
  engine-internal and listed in the B-upstream-sync research; they are not desktop identifiers.

## 2. How upstream's scripts are used

### `scripts/export-brand-icons.ts` (`vp run icons:export`, `vp run icons:check`)

- Input: the three Icon Composer projects (`assets/{dev,nightly,prod}/app-icon.icon`).
- Requires macOS with Icon Composer 2 (from Xcode or standalone); it pins design generation 26 and
  finds `ictool` automatically (`ICON_COMPOSER_TOOL=/path/to/ictool` overrides).
- Output per brand: `*-ios-1024.png`, `*-universal-1024.png`, the four web favicon files, and the
  Windows `.ico` (frames 16–256 px, encoded by `scripts/lib/icon-export.ts`).
- It does **not** regenerate the macOS `*-macos-1024.png`: the command-line exporter lacks the
  "macOS pre-Tahoe" preset. Export that one by hand in Icon Composer (Platform `macOS pre-Tahoe`,
  Appearance `Default`, Size `1024pt`, Scale `1×`) and save over `assets/prod/black-macos-1024.png`.
  Details and the verification rule are in `assets/README.md`.
- `--check` verifies the tracked exports match the project without writing.
- The `dev` exports are also copied into `apps/web/public` (the stock client's favicon).

So for Foreman: open `assets/prod/app-icon.icon` in Icon Composer, replace the `text.svg` /
`background.svg` layers with our artwork, run `vp run icons:export`, export the macOS PNG by hand,
commit the changed binaries under `assets/prod/**`.

### `scripts/apply-web-brand-assets.ts`

- `node scripts/apply-web-brand-assets.ts [development|nightly|production] [target-dir]`
  (defaults: `production`, `apps/web/dist`); `--channel latest|nightly` maps a release channel to a
  brand.
- Copies the four favicon files for that brand into the target directory (see table above).
- `scripts/build-desktop-artifact.ts` imports `applyWebBrandAssets` and runs it against
  `apps/server/dist/client` for every desktop build, so no extra step is needed once the `prod`
  files are replaced. Our `/simple/` client's favicons are unaffected (it has its own `public/`).

### What the desktop build does with the files

`scripts/build-desktop-artifact.ts` → `resolveDesktopBuildIconAssets(version)` picks the `prod`
trio (`macIconPng`, `linuxIconPng`, `windowsIconIco`), builds `icon.icns` with `iconutil` from the
macOS PNG, writes the Linux `icons/` set from the universal PNG, and copies the `.ico` as
`icon.ico`. Nothing to configure for us.

## 3. Human-only items (cannot be done by an agent)

- **Final product name** → `nondev/brand.json` + `apps/desktop/package.json` `productName`, then
  `node nondev/scripts/apply-brand.ts` must pass. Also pick the final `appId` (reverse-DNS, must
  stay stable forever: macOS keychain items and Windows registry keys are tied to it), the URL
  scheme, and the home directory name.
- **Apple Developer Team ID + Developer ID Application certificate** for signing/notarising
  (`T3CODE_APPLE_TEAM_ID`, `scripts/sign-macos.ts`), and a provisioning profile only if passkeys are
  wanted (`T3CODE_MACOS_PROVISIONING_PROFILE`). Unsigned builds run only after right-click → Open.
- **Windows code-signing certificate** (optional until a Windows build ships).
- **Icon artwork**: the `assets/prod/**` files listed in section 1, plus the DMG background SVG.
- **A PostHog project of our own** if usage analytics are ever wanted (`telemetry.posthogKey` /
  `posthogHost` in `brand.json`). Until then telemetry is off and pointed at a local sink.
- **Privacy policy URL** for our client (upstream's `apps/web/src/legalLinks.ts` points at
  t3.codes; our client needs its own).
