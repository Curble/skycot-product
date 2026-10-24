// Who is who: the people in a Family profile (children and grown-ups) and the devices linked
// to them. Pure rules the engine enforces and the screens read, so both say the same thing.
// The engine (apps/server/src/skycot/family-devices) is the judge; this file only names the
// rules. See docs/nondev/WHO-IS-WHO.md for the model.
//
// The identity of a linked device lives in its T3 sign-in itself: the engine creates the
// one-time pairing link with the subject `skycot-family-device:<deviceId>`, and the session the
// device gets from it carries that subject for as long as it lives. A client cannot change its
// subject or widen its scopes (token exchange only narrows), so a device can never claim to be
// somebody else, and removing the device record (plus its sessions) ends it at once.

/** The subject prefix every Family-linked device's sign-in carries. */
export const DEVICE_SUBJECT_PREFIX = "skycot-family-device:";

/** A linked device's subject, for the pairing link. */
export function deviceSubject(deviceId: string): string {
  return `${DEVICE_SUBJECT_PREFIX}${deviceId}`;
}

/** The device id a sign-in subject names, or null for every other sign-in (the Mac's own, an old pairing). */
export function deviceIdFromSubject(subject: string | null | undefined): string | null {
  if (typeof subject !== "string" || !subject.startsWith(DEVICE_SUBJECT_PREFIX)) return null;
  const id = subject.slice(DEVICE_SUBJECT_PREFIX.length);
  return /^d[0-9a-f]{6,32}$/.test(id) ? id : null;
}

/**
 * The permission a grown-up's device holds, beside T3's read-only scope: it may answer
 * "Ask a grown-up" requests (accept or decline, once each), give more time and lock everything.
 * It is SKYCOT's own name, reported to clients so a future phone app can show the right screens;
 * the engine never trusts a client's claim to it.
 */
export const FAMILY_APPROVER_PERMISSION = "family:approver";

export type DeviceKind = "child" | "grown-up";

export const MAX_GROWN_UPS = 6;
export const MAX_DEVICES = 24;
export const PERSON_NAME_MAX = 40;
export const DEVICE_NAME_MAX = 40;
/** How long a device link stays usable. Short: it is shown on the Mac's screen. */
export const LINK_TTL_MS = 5 * 60_000;
/**
 * A request the grown-up's phone has not answered in this long lapses there; the card stays on
 * the Mac, where the parent code still works (the approval contract, rule 4).
 */
export const APPROVAL_LAPSE_MS = 30 * 60_000;
/** How long a passkey challenge stays open (registering one, or saying yes with Face ID). */
export const PASSKEY_CHALLENGE_TTL_MS = 2 * 60_000;

/**
 * Saying yes from a grown-up's Apple Watch (Phase 4, decision 4: Yes and No while the Watch is
 * unlocked and on the wrist, the Apple Pay standard). The Watch keeps its own signing key (in
 * the Secure Enclave where the Watch has one), made once with the parent code typed on the
 * paired phone; the Mac keeps only the public half, on that phone's device record. For each yes
 * the Mac gives a challenge for that one action (as for a passkey: two minutes, single use, this
 * device only) and the Watch signs this message over it. The phone only carries the message, as
 * the relay does, so a phone on its own can never say yes for the Watch.
 */
export const WATCH_MESSAGE_PREFIX = "SKYCOT Watch v1";
export type WatchPurpose = "register" | "approve";

/** The exact text a Watch signs (ECDSA P-256, SHA-256). The Watch app builds the same lines. */
export function watchSignedMessage(
  purpose: WatchPurpose,
  challenge: string,
  action: string,
): string {
  return [WATCH_MESSAGE_PREFIX, purpose, challenge, action].join("\n");
}

/** The action a Watch's key is registered under: one key per grown-up's phone. */
export function watchRegisterAction(deviceId: string): string {
  return `watch-register:${deviceId}`;
}

/**
 * Where the Watch says its key lives. A label for the record, never a reason to trust: the Mac
 * can't check it (Apple's App Attest would, once SKYCOT has an Apple account step for it).
 */
export const WATCH_KEY_PROTECTIONS = ["secure-enclave", "keychain", "simulator"] as const;
export type WatchKeyProtection = (typeof WATCH_KEY_PROTECTIONS)[number];

export function isWatchKeyProtection(value: unknown): value is WatchKeyProtection {
  return (WATCH_KEY_PROTECTIONS as ReadonlyArray<unknown>).includes(value);
}

/**
 * Saying yes with Face ID on the grown-up's own iPhone ("the Face ID key"). The same design as
 * the Watch's: the phone makes a P-256 key in its Secure Enclave that only signs after Face ID
 * (or Touch ID) for that one signature, and that iOS makes useless if the enrolled faces or
 * fingers change. It is set up once with the parent code; the Mac keeps only the public half,
 * on that phone's device record. For each yes the Mac gives a challenge for that one action
 * (two minutes, single use, this device only) and the phone signs this message over it.
 *
 * Its own first line, so a signature made for the Watch never fits as the phone's, or back.
 */
export const DEVICE_KEY_MESSAGE_PREFIX = "SKYCOT Device Key v1";
export type DeviceKeyPurpose = WatchPurpose;

/** The exact text the phone's Face ID key signs (ECDSA P-256, SHA-256), in the Watch's shape. */
export function deviceKeySignedMessage(
  purpose: DeviceKeyPurpose,
  challenge: string,
  action: string,
): string {
  return [DEVICE_KEY_MESSAGE_PREFIX, purpose, challenge, action].join("\n");
}

/** The action a phone's Face ID key is registered under: one key per grown-up's device. */
export function deviceKeyRegisterAction(deviceId: string): string {
  return `device-key-register:${deviceId}`;
}

/**
 * Which of Apple's checks guards the key, as the phone says (an iPad may have Touch ID). Words
 * for the log and the recap, never a reason to trust: the Secure Enclave's own rule is.
 */
export const DEVICE_KEY_BIOMETRICS = ["face-id", "touch-id", "optic-id"] as const;
export type DeviceKeyBiometry = (typeof DEVICE_KEY_BIOMETRICS)[number];

export function isDeviceKeyBiometry(value: unknown): value is DeviceKeyBiometry {
  return (DEVICE_KEY_BIOMETRICS as ReadonlyArray<unknown>).includes(value);
}

/** "Face ID", "Touch ID", "Optic ID". */
export function biometryWords(biometry: DeviceKeyBiometry): string {
  return biometry === "touch-id" ? "Touch ID" : biometry === "optic-id" ? "Optic ID" : "Face ID";
}

/** Who is using SKYCOT on a signed-in device, as the engine sees it. */
export type FamilyIdentity =
  /** The family's Mac, or any sign-in that is not a linked device: today's behaviour ("Who's using SKYCOT?"). */
  | { readonly kind: "shared" }
  /** A child's own device: always that child; sees only their own work and the fridge's pins. */
  | {
      readonly kind: "child";
      readonly deviceId: string;
      readonly childId: string;
      readonly deviceName: string;
    }
  /** A grown-up's device: reads everything, answers requests, and nothing else. */
  | {
      readonly kind: "grown-up";
      readonly deviceId: string;
      readonly personId: string;
      readonly deviceName: string;
    }
  /** A linked device that was removed (or whose profile was turned off): refused everything. */
  | { readonly kind: "removed" };

/**
 * The only answers a grown-up's device may give. "Allow for the session" and "Always allow" are
 * never offered there (the approval contract, rule 6), whatever a client sends.
 */
export const APPROVER_DECISIONS = ["accept", "decline"] as const;
export type ApproverDecision = (typeof APPROVER_DECISIONS)[number];

export function isApproverDecision(value: unknown): value is ApproverDecision {
  return value === "accept" || value === "decline";
}

/** A typed link code, read the way people type it: spaces, dashes and lower case forgiven. */
export function normaliseLinkCode(value: string): string {
  return value.replace(/[\s-]+/g, "").toUpperCase();
}

/** "7KQ3 M9XD 2HPA": the code in groups of four, easier to read across a room. */
export function groupLinkCode(code: string): string {
  return normaliseLinkCode(code).replace(/(.{4})(?=.)/g, "$1 ");
}

/** Who started each conversation and project, as the engine keeps it (child ids). */
export interface Owners {
  readonly threads: Readonly<Record<string, string>>;
  readonly projects: Readonly<Record<string, string>>;
}

/**
 * Whether a child's own device may see a conversation: only the child's own. A conversation
 * nobody is recorded as starting (from before the Family profile knew who started what, or one a
 * grown-up started) is a grown-up's, so it stays off a child's device.
 */
export function childSeesThread(childId: string, threadId: string, owners: Owners): boolean {
  return owners.threads[threadId] === childId;
}

/**
 * Whether a child's own device may see a project: their own, or one nobody owns (a family
 * project a grown-up set up, older projects), which every child shares. Inside a shared project
 * each child still sees only their own conversations. A brother's or sister's project stays
 * hidden, unless the child has a conversation of their own in it. Questions spaces are owned
 * like projects (a child's own, or the grown-ups' shared one: `questionsSpaceOwners`).
 */
export function childSeesProject(
  childId: string,
  projectId: string,
  owners: Owners,
  projectsWithOwnThreads: ReadonlySet<string> = new Set(),
): boolean {
  const owner = owners.projects[projectId];
  return owner === undefined || owner === childId || projectsWithOwnThreads.has(projectId);
}

/** Plain English for a device's kind, for lists ("Ava's iPad · Child's device"). */
export function deviceKindLabel(kind: DeviceKind): string {
  return kind === "child" ? "Child's device" : "Grown-up's device";
}

/** What a device kind may do, in words for the Family settings. */
export function deviceKindSummary(kind: DeviceKind): string {
  return kind === "child"
    ? "Always this child. Sees only their own work and what's on the fridge."
    : "Sees everyone's conversations and the weekly recap, and can say yes or no to requests. It can't send messages or change anything.";
}

/** Clean a person's or device's name: trimmed, single spaces, bounded; empty is null. */
export function cleanName(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}
