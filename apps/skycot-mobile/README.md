# SKYCOT for iPhone and iPad

Phase 3 of [SKYCOT on iPhone, iPad and Apple Watch](../../docs/nondev/report/2026-10-23-skycot-on-iphone-ipad-watch.html).
One app, **SKYCOT**, that becomes a **child's device** or a **grown-up's phone** when a grown-up
links it at the family's Mac. The Mac stays the brain: this app is a window into it, with no
account, no cloud copy of anyone's work, and no over-the-air code updates.

Words used below: **Expo** is the toolkit the app is built with (React Native: one app for iPhone,
iPad and later Android). **Prebuild** turns this folder into an Xcode project (`ios/`, generated,
never edited, not in git). **Simulator** is the iPhone/iPad simulator on the Mac. **Engine** is the
part of SKYCOT on the Mac that runs everything. **Relay** is SKYCOT Relay (Phase 2,
[RELAY.md](../../docs/nondev/RELAY.md)).

## What it does

- **First run:** "Link to your family's Mac". Scan the QR code from the Mac's Settings › Family ›
  Phones and iPads › Link… (camera), or type the twelve-letter code and the Mac's address. The link
  decides the mode; a device can link to more than one home Mac (each shown with its name), but all
  its links are one kind.
- **Child mode** (Workshop look unless a grown-up picked another): always that child. Make (greeting,
  starter cards, Just ask, their own conversations from every linked Mac), the conversation's plain
  cards (Here's my plan with Build it / Change the plan, Ask a grown-up with the parent code, What
  changed with Open it / Undo all of it), the fridge with page previews (offline), stickers,
  "SKYCOT is asleep" with Ask a grown-up for more time, and on-device voice typing when a grown-up
  turned talking on. The personal-details shield runs before a message leaves the device. There are
  no developer screens at all.
- **Grown-up mode** (Apple look): Requests (Allow once with Face ID or the parent code, or
  Decline), Children (today, their conversations read only, their week, more time) and This
  device (Face ID, Lock everything, linked Macs, Unlink). The words and rules are Phase 1's
  grown-up phone.
- **Face ID to say yes** (build 4 onwards): "Use Face ID to say yes" in This device, set up once
  with the parent code. The phone makes a P-256 key in its Secure Enclave
  (`modules/skycot-device-key`; access control `biometryCurrentSet` + `privateKeyUsage`, so every
  signature needs Face ID or Touch ID and iOS voids the key if the enrolled faces change), and
  each linked Mac keeps the public half on this device's record. Allow once then asks the Mac
  for a one-use challenge for that one request (thread, request and card fingerprint), Face ID
  signs it (`deviceKeySignedMessage`, packages/skycot-rules/src/people.ts) and the Mac checks
  it before saying yes; logged as "approved with Face ID on Mum's iPhone". Cancelled, failed or
  not set up: the parent code sheet, as before. Decline stays free. "Stop using Face ID" needs
  no code; the Mac's Remove forgets the key too. The steps are `src/faceid/faceId.ts`.
- **iPad:** a sidebar beside the content (T3's layout breakpoints); iPhone: the system tab bar.
- **Apple Watch** (grown-ups, Phase 4, [WATCH.md](../../docs/nondev/WATCH.md)): a SwiftUI
  companion in `watch/SkycotWatch` with Requests (Allow once / Decline on the wrist, while the
  Watch is unlocked and on the wrist), Today and Lock SKYCOT now. It talks only to this app
  (WatchConnectivity); a yes is signed by the Watch's own key over the Mac's challenge.
- **Live Activity and widget:** "Sam is building…" / "Sam needs your OK" on a child's device,
  "Ava needs a grown-up" on a grown-up's, content-free, from what the app last saw.

## Where things are

| Folder                                      | What                                                                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/transport/`                            | `MacTransport`: every way to a Mac. `direct` (home Wi-Fi, Tailscale), `relay` (sealed tunnel), `failover` (relay first, then the Mac's address)                             |
| `src/links/`                                | linking (Phase 1's one-use code swapped at `/oauth/token`), the keychain store, deep links                                                                                  |
| `src/engine/`, `src/family/`                | the engine's reads and commands (T3's own RPC protocol), the Family routes; parsing is the plain client's own code                                                          |
| `src/screens/child`, `grownup`, `shared`    | the screens; `src/app/` the shells for each mode                                                                                                                            |
| `src/widgets/`, `src/activity/`             | the Live Activity (forked from T3's `AgentActivity`) and widget, and the words they show                                                                                    |
| `watch/SkycotWatch/`                        | the Apple Watch app (Swift); `plugins/withSkycotWatch.cjs` adds its target at prebuild                                                                                      |
| `modules/skycot-watch/`, `src/watch/`       | the iPhone side of the Watch: WatchConnectivity, the notification with Allow once / Decline, the snapshot and the Watch's messages                                          |
| `modules/skycot-speech/`                    | on-device voice typing (Apple Speech, `requiresOnDeviceRecognition`)                                                                                                        |
| `modules/skycot-device-key/`, `src/faceid/` | Face ID to say yes: the Secure Enclave key (Swift) and the set up / Allow once / stop steps                                                                                 |
| `src/dev/`                                  | the recorded demo conversations (the sample family ships them in the app as sample content); the `skycot-dev://demo/…` links that open them are for development builds only |

Logic is reused, not rewritten: `apps/nondev/src/plain` (approvals, changes, titles),
`apps/nondev/src/features/{family,family-limits,fridge,recap,starters,questions,badges}` (pure
parts) and `packages/skycot-rules`. Visibility is the engine's: a child's device receives only that
child's work, and the app never filters on its own.

## What came from T3's `apps/mobile` (MIT), and what didn't

This is a SKYCOT-only fork, so `apps/mobile` is untouched and T3's updates stay mergeable. Taken:
the Expo/React Native versions and config shape, the widget asset plugin, the `AgentActivity` Live
Activity layouts (rebranded), the split-layout breakpoints, the bare-socket RPC pattern from
`client-runtime`. Left out: Clerk, T3 Connect, Axiom traces, the EAS project and owner, the update
URL, T3's team and bundle ids, and every developer screen (terminal, diffs, pull requests, files,
browser). `node nondev/scripts/t3-address-guard.ts` fails if any T3 identity comes back.

## Build and run in the Simulator

```bash
source ~/.config/vite-plus/env && pnpm install --frozen-lockfile     # from the repo root
cd apps/skycot-mobile
APP_VARIANT=development EXPO_NO_GIT_STATUS=1 ./node_modules/.bin/expo prebuild --clean --platform ios --no-install
(cd ios && pod install)
xcodebuild -workspace ios/SKYCOTDev.xcworkspace -scheme SKYCOTDev -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  DEVELOPMENT_TEAM= CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- build
APP_VARIANT=development ./node_modules/.bin/expo start --port 8081           # the JavaScript, for Debug
xcrun simctl install booted <DerivedData>/Build/Products/Debug-iphonesimulator/SKYCOTDev.app
```

No Apple account, certificate or profile is needed for the Simulator ("sign to run locally").
Run `pod install` with `LANG=en_US.UTF-8` (CocoaPods fails on a non-UTF-8 terminal).

**With the Watch:** the same build also builds `SkycotWatch.app` (watchOS Simulator) into
`SKYCOTDev.app/Watch/`. Pair simulators once (`xcrun simctl pair <watch> <phone>`), install the
iPhone app on the phone and `SKYCOTDev.app/Watch/SkycotWatch.app` on the Watch
(`xcrun simctl install <watch> …`), and open both. The Watch's own test steps are in
[WATCH.md](../../docs/nondev/WATCH.md#testing-in-the-simulator).

**Development-build test hooks** (never in the App Store build): `-skycotTestLink <url>` as a launch
argument hands the app a link at start (`xcrun simctl launch <device> com.skycot.app.ios.dev
-skycotTestLink "skycot-dev://link?code=…&address=127.0.0.1:3895&go=1"`), so a Simulator can be
linked without taps; `…?url=<whole QR link>&go=1` links through the relay; `skycot-dev://demo/plan`
(`ask`, `made`) shows a demo conversation; `skycot-dev://section/fridge` and `…/open/macs` open
screens.

## Build and install on your own iPhone (development signing)

For testing on a real device, build the development app (`com.skycot.app.ios.dev`, "SKYCOT Dev")
in **Release** so the JavaScript is inside the app and it runs without `expo start` on the Mac.
Xcode's automatic signing for team `3F72LCWGG2` registers the development app ids (app, `.widgets`,
`.watchkitapp`), the App Group and the device, and makes development profiles; no App Store
Connect record, distribution certificate or push key is involved.

```bash
APP_VARIANT=development EXPO_NO_GIT_STATUS=1 ./node_modules/.bin/expo prebuild --clean --platform ios --no-install
(cd ios && LANG=en_US.UTF-8 pod install)
cd ios && APP_VARIANT=development LANG=en_US.UTF-8 xcodebuild -workspace SKYCOTDev.xcworkspace \
  -scheme SKYCOTDev -configuration Release -destination 'id=<the iPhone UDID>' \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM=3F72LCWGG2 CODE_SIGN_STYLE=Automatic build
xcrun devicectl device install app --device <device> <DerivedData>/Build/Products/Release-iphoneos/SKYCOTDev.app
```

`xcrun devicectl device info details --device <id>` shows the UDID and whether Developer Mode is
on. The Watch app is only provisioned for a Watch that is registered with the team, which needs
the Watch's Developer Mode on first; then build again and install
`SKYCOTDev.app/Watch/SkycotWatch.app` on the Watch. For the engine, run it with `--host 0.0.0.0`
(or the Mac's LAN address) so the phone on the same Wi-Fi can reach it; the Family link's QR code
then carries the Mac's home-network address. The first link asks for Local Network access on the
phone (Allow).

## Checks

- `vp test run` (here): linking, links, the ways to a Mac, the cards. The
  `src/test/*.integration.test.ts` files run against a real local engine (and relay) when
  `SKYCOT_TEST_ENGINE`, `SKYCOT_TEST_CHILD_CODE`, `SKYCOT_TEST_RELAY_LINK` … are set.
- `tsc-rs --noEmit` (here), `node nondev/scripts/t3-address-guard.ts`, `node nondev/scripts/check-seams.ts --working-tree --strict`.

## Waiting for later, honestly

- **Passkeys** (the browser's Face ID, for the plain client in Safari) still need one stable
  https address the app is entitled to; the phone app doesn't need them any more (Face ID to say
  yes uses its own Secure Enclave key, above).
- **Notifications** (build 3 onwards): the app has the push entitlement (`aps-environment`,
  production for TestFlight and the App Store, development for SKYCOT Dev), asks iOS for its push
  token (`modules/skycot-watch`, `registerForPush`) and hands it to each Mac linked through the
  relay (`src/push/PushRegistration.tsx` → `RelayHome.registerPush`). "SKYCOT needs a grown-up"
  carries the same Allow once / Decline as the app's own notification but names no request:
  Allow once opens Requests (a yes still needs the card and Face ID or the parent code), Decline
  declines the one waiting request or posts one notification each when several wait. They need
  the relay's APNs secrets; Macs linked without the relay get none. **Live Activity pushes** are
  not on yet: the Live Activity updates only while the app is open.
- **Away from home** works through the relay once Mark deploys it; until then, the home Wi-Fi or
  Tailscale. A relay-only QR code doesn't carry the Mac's home address, so such a device uses the
  relay at home too.
- **Apple Watch**: built (Phase 4). iOS forwards the relay's pushes to it when the phone is
  locked (a forwarded "needs a grown-up" opens the Watch's Requests list); the Smart Stack view
  itself was not opened in the Simulator.
  **Android** later (the code is ready for it; no Android build here).
- Pictures in messages, drawing starter cards and reading replies aloud are not on the phone yet.

## What needs Mark (Apple)

App Store Connect app record for `com.skycot.app.ios` (and `.dev` for TestFlight), App Groups
`group.com.skycot.app.ios`, the widget extension id `com.skycot.app.ios.widgets`, Push Notifications
and an APNs key (shared with the relay), the associated domain for passkeys, and the signing set-up
for team `3F72LCWGG2`, and the Watch app's id `com.skycot.app.ios.watchkitapp` (signed with the
same team; App Attest for the Watch's key is optional, later). None of this was done here.

## Build flag: child mode (SKYCOT_MOBILE_CHILD_MODE)

Version 1 is a grown-up companion. Child mode is built in only when `SKYCOT_MOBILE_CHILD_MODE=1`. It is OFF for `production` (App Store, TestFlight) and ON by default for `APP_VARIANT=development` (internal testing; set `SKYCOT_MOBILE_CHILD_MODE=0` to test the grown-up-only build). With it off, the speech and microphone purpose strings are not in Info.plist. See `docs/nondev/autopilot/briefs/2026-10-29-phone-grown-up-only.md`.
