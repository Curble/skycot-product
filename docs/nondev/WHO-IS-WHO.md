# Who is who: the identity and approver model

Phase 1 of [SKYCOT on iPhone, iPad and Apple Watch](report/2026-10-23-skycot-on-iphone-ipad-watch.html).
This note is for whoever builds Phases 2 to 4 (the relay, the iOS app, the Watch): what a
"person", a "device" and an "approver" are, where each is decided, and what the later phases
must keep true. The parent-facing description is in [FAMILY.md](FAMILY.md#people-and-devices-who-is-who).

## The model in one paragraph

The family's Mac is the only judge. A **person** is a child or a grown-up in the Family profile.
A **device** is linked to exactly one person and is either a **child's device** or a
**grown-up's device**. The device's identity is carried by its own T3 sign-in: the engine makes
T3's one-time pairing link with the subject `skycot-family-device:<deviceId>` and with the scopes
for that kind of device, and the session the device gets from the link keeps both for its whole
life. No client can change its subject or widen its scopes. The Family profile's device record
says whose it is; removing the record (and revoking the session) ends the device at once. The
parent code stays the root secret, and a passkey is only ever a per-device stand-in for typing it.

## Where each piece lives

| Piece                                                       | Where                                                                                                          | Notes                                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| People (children, grown-ups), devices, passkeys             | `skycot-family.json` (`SkycotFamily.ts`)                                                                       | Optional keys on file version 2; a beta 2 file reads with one grown-up whose id derives from the file's salt |
| Who a session is                                            | `family-devices/SkycotFamilyIdentity.ts`                                                                       | `shared` (the Mac, older pairings), `child`, `grown-up`, `removed`                                           |
| Device links, the devices list, Remove, passkeys, approvals | `family-devices/SkycotFamilyDevices.ts`                                                                        | Uses `EnvironmentAuth.createPairingLink`, `listSessions`, `revokeSession`, `revokePairingLink`               |
| Per-person visibility                                       | `family-devices/SkycotFamilyVisibility.ts`, `visibility.ts`, `httpVisibility.ts`                               | Rules in `@t3tools/skycot-rules/people`                                                                      |
| Enforcement on the socket                                   | `SkycotFamilyGate.judgeDevice` (every RPC) and the shell stream filter (ws.ts seam `skycot-family-visibility`) |                                                                                                              |
| Enforcement over HTTP                                       | `SkycotFamilyHttp.layerApiGate` (global middleware)                                                            | filters `/api/orchestration/shell` and `/api/projects` answers                                               |
| Passkey checks                                              | `family-devices/passkeys.ts`                                                                                   | `@oslojs/webauthn` parses; Node's crypto verifies                                                            |
| Client screens                                              | `apps/nondev/src/features/family/PeopleAndDevices.tsx`, `features/grown-up/`                                   |                                                                                                              |

## What each kind of device may do

- **The family's Mac (`shared`)**: everything it could before, behind the parent code as before.
  The "Who's using SKYCOT?" picker stays, and siblings' work stays visible there (decision 5).
- **A child's device**: T3 scopes `orchestration:read/operate`, `settings:write`,
  `preview:operate`, `diagnostics:read`, `source-control:write`, `filesystem:read/write`
  (`CHILD_DEVICE_SCOPES`). No terminals, environment maintenance, provider sign-ins, access or
  relay management: Advanced mode cannot work there, and `verify` refuses `advanced` on it. Its
  child is fixed (`SkycotFamilyLimits.childFor`); a grown-up's code can reassign it. Every call
  naming a conversation, project or folder must name the child's own (`childSeesThread`,
  `childSeesProject`, a brand-new id counts as theirs), except that a page pinned to the fridge
  may be read.
- **A grown-up's device**: T3 scope `orchestration:read` only (`GROWN_UP_DEVICE_SCOPES`), checked
  again by the gate (`grownUpDeviceMayCall`). SKYCOT's own permission name for it is
  `family:approver`, reported in `GET /api/skycot/family` → `me.permissions`. It answers through
  `/api/skycot/family/approver/*` and never through `runtime-request.respond` directly.
- **A removed device**: nothing.

## The approval contract, as built

1. The Mac decides: the approver route checks the request is pending and live, then the engine
   itself dispatches `runtime-request.respond`.
2. Approver-only: read scope plus the approver routes; no settings, files or pairing.
3. One card, once: the answer names one request id and a fingerprint (a hash of the request id
   and the words the phone showed). A changed card is refused; a resolved one finds nothing.
4. Short-lived: older than ten minutes (`APPROVAL_LAPSE_MS`), it waits on the Mac.
5. Proof: a passkey assertion over a challenge bound to that device and that one action
   (`approve:<thread>:<request>:<fingerprint>` hashed with a nonce, two minutes, single use), or
   the parent code, which counts towards the same five-try lockout.
6. Decline is free; `acceptForSession` and `acceptAlways` are refused by the route.
7. Quiet lock screen: not built yet (no notifications in Phase 1).
8. Revocable: Remove, Unlink this device, removing the person, a new parent code (grown-ups'
   devices) and turning the profile off (all devices).
9. On the record: an `approved` or `declined` event in the activity log with the child, the
   request id and `by: { personId, deviceId, deviceName }`; the recap shows "Approved from …".

## What Phases 2 to 4 must keep

- **The relay must not become a judge.** It carries the same T3 sessions end to end; identity and
  scopes stay in the Mac's session store and Family profile. A relay token is never a device's
  sign-in.
- **Link by the same pairing link.** The iOS app should accept the same QR code (the URL carries
  the one-time code after `#token=`) and exchange it the same way; its device record is the same.
- **Passkeys and the relying party.** A passkey is bound to the address it was made on (today
  `localhost`, or a Tailscale `https` name). The relay and the app need one stable relying party
  (for example a SKYCOT domain with associated domains in the app), and existing passkeys will
  need to be made again once. Keep the parent code as the fallback everywhere.
- **The Watch** answers through the same approver routes, with the iPhone app's key or its own;
  decision 4 allows Yes and No on an unlocked Watch on the wrist.
- **Notifications** say only "Sam needs a grown-up" plus a request id; details come from
  `/approver/requests` after unlock.
- **Visibility is the engine's.** A child's app must not filter on its own: it receives only what
  the engine sends.

## Phase 2 (SKYCOT Relay), as built

[RELAY.md](RELAY.md). The relay carries the same T3 sessions end to end: the Mac's end
(`skycot/relay/tunnelHandler.ts`) hands each request to the engine's own server with the
device's own sign-in, so the gate, the HTTP API gate and the visibility filters judge it as a
local one. On top, a relay connection only carries the sign-in of the device it was linked for
(its relay id is recorded against the Family device id when the link is made), and a sign-in
made through it for another device is revoked. The QR link is the same one with the relay part
after the `#`. Removing a device also revokes its relay pass and closes its tunnel.

## Honest limits in Phase 1

- The engine listens on the Mac, so links only open on this Mac (or the LAN or Tailscale when
  SKYCOT is set to listen there), unless SKYCOT Relay is on (Phase 2).
- Passkeys need `localhost` or `https`; over plain LAN the code is used.
- Conversations with no recorded child (older ones, a grown-up's) stay off children's devices.
- A sign-in lasts 30 days (T3's session lifetime), then the device is linked again.
- Sessions paired the old way (not from Settings › Family) are treated as the Mac.
