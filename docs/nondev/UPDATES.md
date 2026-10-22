# SKYCOT's own updates

How SKYCOT gets new versions of itself, why it can never pick up T3 Code's, and how to switch
the Mac feed on once there is a signed public download. (Updating an AI service's program is a
separate item, BACKLOG #13.)

## What people see

- **Settings → About → Updates** says where things stand, in plain words:
  - _Updates will arrive here once SKYCOT's Mac download opens._ (today: there is no feed)
  - _Looking for a new version…_, _You're up to date._ (with when it last checked) and
    **Check for updates**
  - _Downloading…_ with a progress bar: a new version downloads by itself as soon as SKYCOT
    finds it. Nothing changes until the restart.
  - _A new version is ready._ with **Restart to update**
  - _Couldn't look for updates just now_ / _The download stopped part-way_ with a retry.
- **The title bar** shows a calm pill once a version has downloaded: _A new version is ready ·
  Restart to update_ (_Update_ on a phone-width window). It never restarts by itself.
- **The restart sheet** lists what is new (SKYCOT's own plain notes; developer changelog lines
  are left out), says that unfinished conversations pick up where they left off after the restart
  (T3's "carry on after a restart", on by default), warns by name when the crew is still working
  (_Sam is still working on 1 conversation. Restarting pauses it; it carries on by itself when
  SKYCOT opens again._), then **Later** or **Restart now** / **Restart anyway**.
- **In a browser** (`skycot serve`, or another device paired with the Mac) there is no Mac app to
  update. About shows the version only, unless the engine knows a newer SKYCOT exists: then it says
  _SKYCOT 1.2.0 is out. To update, download the new version from skycot.com and open it._ (or, when
  the engine belongs to the Mac app, to open SKYCOT on that Mac). The engine learns this only by
  reading SKYCOT's own feed's `latest-mac.yml`, at most every six hours; with no feed it contacts
  nothing.

## Family profile

Checking and downloading stay open to everyone: neither changes anything. **Restarting into a new
version needs the parent code**, and the desktop app enforces it, not only the screen:

1. **Restart now** asks for the parent code (engine grant `update`, two minutes; the Advanced-mode
   grant also covers it).
2. The client calls `POST /api/skycot/updates/allow-restart` with the version. The engine checks
   the grant and writes a short-lived note beside the profile
   (`~/.skycot/userdata/skycot-update-unlock.json`: that one version, two minutes).
3. The Mac app's install handler (`apps/desktop/src/skycot/updates.ts`) reads the Family profile
   itself. While it is on, it restarts only with a fresh note for the downloaded version, and
   deletes the note as it reads it. Without one it does nothing, whichever screen asked.

The remote path (another device asking the engine to update the Mac app,
`server.commitDesktopUpdate`) is behind the engine's Family gate (Advanced mode).

Honest limits: someone who can use Terminal or Finder on the Mac account could write the note
file (or delete the profile, see FAMILY.md). The **Restart to update** button in Advanced mode does
nothing while the profile is on; use Settings → About in SKYCOT instead.

## Never T3 Code's releases

SKYCOT is a fork of T3 Code. A feed that pointed at `pingdotgg/t3code` would quietly replace
SKYCOT with T3 Code on the next restart and drop every Family rule. So:

| Layer                    | Rule                                                                                                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One source               | `nondev/brand.json` → `updates.feed`; `nondev/brand/env.cjs` passes it on as `T3CODE_SKYCOT_UPDATE_FEED` (`"none"` for no feed)                                                                                                               |
| The build                | `scripts/build-desktop-artifact.ts` (seam `skycot-update-feed-build`) bakes only that feed into the app's `app-update.yml`, or none. It never falls back to `GITHUB_REPOSITORY` (upstream's CI sets it to `pingdotgg/t3code`)                 |
| The installed app        | `DesktopUpdates.ts` (seam `skycot-update-feed`) passes the baked feed through `vetBakedFeed`: only the brand's exact feed is used; T3 Code's never, and nothing while the brand has none. A refused feed reads as "no feed": updates stay off |
| The engine               | reads the brand's feed only, and refuses one that names T3 Code before any request                                                                                                                                                            |
| T3 Code, however written | `github:pingdotgg/…`, any repository named `t3code`, `*.t3.codes`, `t3.gg`, GitHub URLs of those repositories: refused everywhere (`packages/skycot-brand/src/updateFeed.ts`)                                                                 |
| Guard                    | `nondev/scripts/update-feed-guard.ts`, run by `node nondev/scripts/apply-brand.ts` and the fork tests in CI, fails if the brand names T3 Code, if `env.cjs` drops the variable, or if an upstream merge removes one of the seams              |

The CLI's `update` command and Advanced mode's release links use `brand.json`
`updateRepository` (`mark-hallam/skycot-product`), checked by the same guard. That repository is
private, so neither works for the public until releases are published somewhere public.

## Switching the Mac feed on (later)

Do this only when a **signed and notarised** Mac build exists. Chosen for the beta (23 October
2026): a generic feed at `https://downloads.skycot.com/mac/` (Cloudflare R2), so the download page
and the updater serve the same files. The full release steps are in [RELEASE.md](RELEASE.md).

1. **Build** with the brand loaded and the feed set:
   ```
   # nondev/brand.json
   "updates": { "feed": "https://downloads.skycot.com/mac/" }
   node nondev/scripts/apply-brand.ts          # must pass
   node --import ./nondev/brand/env.cjs scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --signed
   ```
   electron-builder writes `latest-mac.yml` next to the `.zip` and `.dmg` (both are needed: the
   updater installs from the zip).
2. **Publish** `latest-mac.yml`, `SKYCOT-<version>-arm64.zip` (and its `.blockmap`) and the
   `.dmg` to `https://downloads.skycot.com/mac/` over https. Upload `latest-mac.yml` last, so an
   app never sees a version whose files are not there yet.
3. **Check** with a copy of the previous version: About should go _Looking…_ → _Downloading…_ →
   _A new version is ready_, and the pill should appear. Try it once with the Family profile on.
4. **Plain release notes**: put a few short, child-friendly lines in the release notes. Lines that
   look like a developer changelog (links, `#1234`, commit hashes, `fix(...)`) are hidden.

Alternative: public GitHub releases of a **public** repository (`"feed": "github:<owner>/<repo>"`).
The private source repository cannot serve updates without a token in every copy, which must
never ship.

A feed already in people's hands can only be changed by shipping a version that names the new
one. Pick the address once.
