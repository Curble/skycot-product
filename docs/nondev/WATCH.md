# SKYCOT on Apple Watch (Phase 4)

Phase 4 of [SKYCOT on iPhone, iPad and Apple Watch](report/2026-10-23-skycot-on-iphone-ipad-watch.html).
This note is for whoever builds on it: what the Watch app is, how it gets its data, how a yes
from the wrist satisfies the approver contract ([WHO-IS-WHO.md](WHO-IS-WHO.md#the-approval-contract-as-built)),
what watchOS lets an app check about "unlocked and on the wrist", and what is honestly not done yet.

## What it is

A small SwiftUI app for a grown-up's Apple Watch, embedded in the SKYCOT iPhone app (the
standard companion arrangement: one watchOS target, bundle id `com.skycot.app.ios.watchkitapp`,
`…​.dev.watchkitapp` for development builds, watchOS 10 and later). A watchOS 10 Watch can pair
with an iPhone on iOS 17; newer Watch and phone versions can pair as Apple allows. React Native
doesn't run on watchOS, so it is plain Swift. Three pages, standard watchOS patterns (vertical paging, lists,
a card that scrolls with the Digital Crown, a confirmation dialog), SF Symbols, the phone's words:

- **Requests**: "Ava needs a grown-up · Run a command · Just now", then the card (the exact step,
  for example `npm install three`, and why it needs a grown-up) with **Allow once** and **Decline**.
- **Today**: each child's time ("23 minutes of 1 hour"), messages, bedtime, and "SKYCOT is asleep".
- **Lock**: **Lock SKYCOT now** (the phone's Lock everything), after a confirmation.

| Where                                                | What                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/skycot-mobile/watch/SkycotWatch/`              | The Watch app (Swift): screens, the phone link, the wrist check, the Watch's key       |
| `apps/skycot-mobile/plugins/withSkycotWatch.cjs`     | Adds the Watch target to the Xcode project `expo prebuild` makes (no other tool)       |
| `apps/skycot-mobile/modules/skycot-watch/`           | The iPhone side in Swift: WatchConnectivity, and the notification with its two buttons |
| `apps/skycot-mobile/src/watch/`                      | The iPhone side in TypeScript: the snapshot, the Watch's messages, setting it up       |
| `apps/server/src/skycot/family-devices/watchKeys.ts` | The Mac checking a Watch's signature                                                   |

## How the Watch gets its data

The Watch has **no link, sign-in or secret for the Mac**. The iPhone is already the grown-up's
linked device, so the Watch talks only to it, over Apple's WatchConnectivity:

- iPhone → Watch: a small snapshot (`src/watch/snapshot.ts`) whenever what the Watch shows
  changes: each waiting request (which child, the phone's heading, the exact step and why, the
  Mac's fingerprint of the card), each child's day, when Lock last ran, whether the phone can
  reach a Mac. Never conversation titles, projects, sign-ins or the Mac's address (tested).
- Watch → iPhone: `hello`, `challenge`, `answer`, `lock` (`src/watch/protocol.ts`). The phone
  does each with its own sign-in, through the same approver routes its own buttons use.

## A yes from the wrist, and the approver contract

The contract wants proof for every yes (a passkey or the parent code). A Watch can do neither:
no passkeys on watchOS, and typing the code on a wrist is not the Apple Pay standard decision 4
chose. Trusting "the phone says the Watch said yes" would weaken the contract (a phone left
unlocked could then say yes for the Watch). So the Watch proves it itself, the way a passkey does:

1. **Setting it up** (iPhone: This device → Apple Watch → Set up): the parent code once, on the
   phone. The Mac gives a one-use challenge; the Watch makes its own P-256 key (in the Secure
   Enclave where it has one) and signs the challenge, proving it holds the key; the Mac keeps
   the public half on the phone's device record (`watch` on the device in `skycot-family.json`).
2. **Each yes**: the Watch asks for a challenge for that one card
   (`/approver/watch/challenge`: this device, `approve:<thread>:<request>:<fingerprint>`, two
   minutes, single use, as for a passkey). The Watch checks the action names exactly the card
   it is showing, and that the card's fingerprint matches the words it shows, then signs
   `SKYCOT Watch v1 / approve / <challenge> / <action>` (`watchSignedMessage`). The phone carries
   the signature in `proof: { type: "watch", … }`; the Mac rebuilds the message from its own
   record of the challenge, so the phone can't swap the request.
3. **On the record**: `by: { personId, deviceId, deviceName, via: { kind: "watch", name } }`;
   the recap says "Approved from Mum's Apple Watch through Mum's iPhone, 1:01 am."

A no needs no proof (rule 6); a no from the Watch is labelled `via: "watch"` by the phone.
More time stays on the phone (the Mac refuses a Watch proof for it). Removing the phone,
"Stop saying yes from the Watch", a new parent code or turning the profile off all end it.

## "Unlocked and on the wrist": what watchOS lets an app check

Every yes and no on the Watch runs the LocalAuthentication policy
`deviceOwnerAuthenticationWithWristDetection` first (`WristCheck.swift`). Apple's own words for
it: authenticated by the device passcode; it also succeeds if Wrist Detection is on, the right
passcode was entered and the Watch has been on the wrist ever since. So:

- **Watch on the wrist since it was unlocked, Wrist Detection on**: passes straight away, silently.
- **Wrist Detection off**: watchOS asks for the Watch's passcode, on the Watch, each time (as
  Apple Pay does).
- **No passcode on the Watch**, or watchOS can't run the check: SKYCOT doesn't guess. It says
  "Answer on your iPhone" (the parent code there).

On top, the key that signs a yes is stored "when passcode set, this device only": watchOS
refuses it while the Watch is locked (it locks when it comes off the wrist), deletes it if the
passcode is turned off, and never backs it up or moves it to another Watch.

What an app **cannot** do: read the Wrist Detection switch or the wrist sensor itself, or see
the passcode. watchOS makes the decision; SKYCOT trusts watchOS, and the Mac trusts the key.

**Honest limits.** The Mac can't tell a Secure Enclave key from a key made in software: the
Watch says where its key lives, and that label is recorded, not checked (Apple's App Attest
could check it; it needs an Apple account step). A Watch that is unlocked and on someone else's
wrist (Wrist Detection off and the passcode known) can say yes, exactly as it could pay. In the
Simulator there is no wrist and no passcode, so the check is skipped there and the screen says
so in small print (`#if targetEnvironment(simulator)`, impossible on a real Watch).

## Notifications

"Ava needs a grown-up", content-free (a name and "needs a grown-up"; the body says to open
SKYCOT), category `SKYCOT_REQUEST` with **Allow once** and **Decline**. On the iPhone, Allow once
opens SKYCOT on Requests (the card and the parent code); Decline answers in the background. On
the Watch both open SKYCOT on that card, because a content-free notification is not enough to say
yes to, and every answer from the Watch runs the wrist check. The iPhone posts it today only
while SKYCOT runs; pushes when SKYCOT is closed wait for SKYCOT Relay's deploy and Apple's push
key (`RelayHome.registerPush` is ready). The Watch app asks no permission of its own: it shows
what the iPhone forwards, under the iPhone's setting.

## Smart Stack

The phone's Live Activity ("Ava needs a grown-up") reaches the paired Watch on watchOS 11 and
later (checked in the Simulator: SKYCOT's icon appears on the watch face). Its small layout
(`bannerSmall` in `src/widgets/AgentActivity.tsx`, used by the Smart Stack and CarPlay) now
has two lines so the name is never cut off. Opening the Smart Stack itself needs a person to turn
the Digital Crown, so that view was not seen.

## A child's Watch: not in v1

Recommended grown-up only for v1, and built that way: if a child's iPhone has the Watch app, it
says "SKYCOT on Apple Watch is for a grown-up's iPhone". Why: a child's own device can only make
and read their own work, which needs a screen; the Watch adds nothing a child needs and a lot to
review (Apple's rules for children's apps, the lawyer's questions on children's privacy, a
second place a child could see a sibling's request). If families ask, the smallest useful child
Watch is "SKYCOT is asleep / you have 10 minutes left", read only. A decision for Mark.

## Testing in the Simulator

`pnpm` checks as everywhere. On paired simulators (see `apps/skycot-mobile/README.md`), with
the development build only:

- iPhone launch arguments: `-skycotTestLink <link>` (Phase 3), `-skycotTestWatchSetup <code>`
  (sets the Watch up once the Watch app is reachable), `-skycotTestQuiet YES` (doesn't ask to
  show notifications, which would need a tap).
- Watch launch argument `-skycotTest <step>`: `today`, `lock-ask`, `open-first`,
  `open-first-buttons`, and three that press a button through the same code as a tap:
  `allow-first`, `decline-first`, `lock-confirm`. Compiled out of every non-Simulator build.
- `xcrun simctl push <watch> com.skycot.app.ios.dev.watchkitapp <payload>` with
  `"category": "SKYCOT_REQUEST"` and `"requestKey": "<macId>:<requestId>"` shows the notification
  once notifications are allowed on that Simulator (a tap on Allow, once).
