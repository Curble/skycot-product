// nondev-seam: skycot-policy-files
// The Family profile, kept by the engine. A child using the parent's Mac must not be able to
// switch the guardrails off by clicking or typing a URL, so the profile, the parent code's
// hash, the wrong-try counter and every "a grown-up said yes" grant live here, in the engine's
// data directory, and the server enforces them (SkycotFamilyGate, SkycotPolicy, the static
// handler, the turn instructions). The client only shows this state and asks for the code.
//
// The file is the source of truth and is re-read whenever it changes on disk (one stat per
// read), so several service instances, or a parent editing it by hand, never disagree.
//
// Version 2 keeps several children under one parent code; each child has a look, voice
// settings and limits (bedtime, daily time, messages per day, a share of the AI allowance to
// leave for grown-ups). A version 1 file (one child) is read as version 2 and written back as
// such on the next change. Daily counters and who-is-using-which-device live beside it in the
// activity file (family-limits/SkycotFamilyLimits.ts), which changes every minute.
//
// Grown-ups and linked devices (Phase 1, "who is who") live here too, as optional keys so a
// file from before them reads unchanged: a profile without grown-ups is read with one, the person
// who set it up, and written that way at its next change. Each linked device names its person
// and kind (a child's device, a grown-up's device) and keeps its passkeys (WebAuthn public keys,
// never anything secret). The sign-in itself stays T3's (family-devices/SkycotFamilyDevices.ts).
//
// Honesty: the file sits in the user's own data directory. Anyone who can use a terminal or
// Finder on this Mac account can delete it, which turns the profile off. That is outside the
// threat model (a curious child, not a determined one) and the docs say so.

// Hashing, HMAC and timing-safe compares have no Effect counterpart; these are pure calls.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { formatClockTime, knownTimeZone, parseClockTime } from "@t3tools/skycot-brand/bedtime";
import { canAllowAssistant, MAX_ALLOWED_ASSISTANTS } from "@t3tools/skycot-rules/assistants";
import {
  cleanName,
  DEVICE_NAME_MAX,
  MAX_DEVICES,
  MAX_GROWN_UPS,
  PERSON_NAME_MAX,
} from "@t3tools/skycot-rules/people";

import * as ServerConfig from "../config.ts";

export const FAMILY_FILE_NAME = "skycot-family.json";
export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 5 * 60_000;
export const CODE_PATTERN = /^\d{4,6}$/;
export const CHILD_NAME_MAX = 40;
export const MAX_CHILDREN = 8;
export const DEFAULT_LOOK = "workshop";

/** The mascot's poses a child can pick as their picture (apps/nondev features/brand/Mascot). */
export const AVATAR_POSES = [
  "hello",
  "yay",
  "thinking",
  "oops",
  "ask-a-grown-up",
  "night-night",
] as const;
/** Colours for a letter picture; the client maps each to a swatch that reads in light and dark. */
export const AVATAR_COLORS = ["sky", "sun", "leaf", "berry", "grape", "coral"] as const;

/** Bounds a parent can pick from; anything outside is clamped, so a hand-edited file stays sane. */
export const LIMIT_BOUNDS = {
  dailyMinutes: { min: 5, max: 12 * 60 },
  dailyTurns: { min: 1, max: 500 },
  keepAllowancePercent: { min: 5, max: 90 },
} as const;

/**
 * What a grown-up can say yes to. `advanced` (the developer interface) is the master grant:
 * a parent working there can also publish, approve and set up automations until it expires.
 */
export const FAMILY_PURPOSES = [
  "approve",
  "publish",
  "automation",
  "openFolder",
  "settings",
  "advanced",
  /** Reading a child's recap (what they made, asked for, and what needed a grown-up). */
  "recap",
  /** Restarting the Mac app into a downloaded SKYCOT update (skycot/updates/SkycotUpdatesHttp.ts). */
  "update",
  /**
   * A grown-up looking through a project's files: Show everything (hidden and secret files,
   * add-ons, build output) and Show in Finder (skycot/files).
   */
  "files",
] as const;
export type FamilyPurpose = (typeof FAMILY_PURPOSES)[number];

export const GRANT_TTL_MS: Readonly<Record<FamilyPurpose, number>> = {
  approve: 5 * 60_000,
  publish: 5 * 60_000,
  automation: 5 * 60_000,
  openFolder: 5 * 60_000,
  settings: 10 * 60_000,
  advanced: 15 * 60_000,
  recap: 10 * 60_000,
  // Long enough to read the warning and press Restart (the desktop's note lasts as long).
  update: 2 * 60_000,
  files: 10 * 60_000,
};

export const UNLOCK_COOKIE_NAME = "skycot_family_unlock";

const Grant = Schema.Struct({
  sessionId: Schema.String,
  purpose: Schema.Literals(FAMILY_PURPOSES),
  requestId: Schema.optionalKey(Schema.String),
  expiresAt: Schema.Number,
});
type Grant = typeof Grant.Type;

const ChildAvatar = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("mascot"), pose: Schema.Literals(AVATAR_POSES) }),
  Schema.Struct({ kind: Schema.Literal("initial"), color: Schema.Literals(AVATAR_COLORS) }),
]);
export type ChildAvatar = typeof ChildAvatar.Type;

const ChildLimits = Schema.Struct({
  /** Local wall-clock times ("19:30" to "07:00") in the profile's time zone; null is no bedtime. */
  bedtime: Schema.NullOr(Schema.Struct({ start: Schema.String, end: Schema.String })),
  /** Minutes of active use a day (see family-limits/limits.ts for how they are counted). */
  dailyMinutes: Schema.NullOr(Schema.Number),
  /** Messages the child may send a day. */
  dailyTurns: Schema.NullOr(Schema.Number),
  /** The child's messages pause once the AI allowance has this many percent left or fewer. */
  keepAllowancePercent: Schema.NullOr(Schema.Number),
});
export type ChildLimits = typeof ChildLimits.Type;

const ChildVoice = Schema.Struct({
  /** Talking instead of typing (the browser's speech service). The voice feature reads this. */
  typing: Schema.Boolean,
  /** Answers read aloud by default. */
  readAloud: Schema.Boolean,
});
export type ChildVoice = typeof ChildVoice.Type;

const Child = Schema.Struct({
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatar: ChildAvatar,
  /** A theme id from the client's library ("workshop"); unknown ids fall back there. */
  look: Schema.String,
  largerText: Schema.Boolean,
  voice: ChildVoice,
  limits: ChildLimits,
  /**
   * "Ask [child] before each step": the child's assistant asks them before every step again,
   * as it did before safe steps ran by themselves. Off (or missing, in a file from before it)
   * means a step no rule holds runs without a card; a step that needs a grown-up always waits
   * (SkycotPolicyReactor). Only a parent changes it (the parent code opens the editor).
   */
  askEachStep: Schema.optionalKey(Schema.Boolean),
  createdAt: Schema.String,
});
export type FamilyChild = typeof Child.Type;

/** Whether this child's assistant asks them before every step (the parent's switch; off by default). */
export function childAsksEachStep(child: Pick<FamilyChild, "askEachStep">): boolean {
  return child.askEachStep === true;
}

/** A grown-up in the family: the person who set the profile up, and anyone they add. */
const GrownUp = Schema.Struct({
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatar: ChildAvatar,
  createdAt: Schema.String,
});
export type FamilyGrownUp = typeof GrownUp.Type;

/**
 * A passkey a grown-up's device registered (WebAuthn): the public key only, as a JWK, with the
 * relying party (the address the device used) it is bound to, and the authenticator's counter.
 */
const Passkey = Schema.Struct({
  /** The credential id, base64url. */
  id: Schema.String,
  /** COSE algorithm: -7 (ES256) or -257 (RS256). */
  algorithm: Schema.Number,
  publicKey: Schema.Record(Schema.String, Schema.String),
  rpId: Schema.String,
  signCount: Schema.Number,
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
});
export type FamilyPasskey = typeof Passkey.Type;

/**
 * A grown-up's Apple Watch that may say yes through that grown-up's phone (Phase 4): its
 * signing key's public half only (P-256, SPKI DER, base64url). One per phone; a new one
 * replaces it. Removing the phone forgets it.
 */
const WatchKey = Schema.Struct({
  id: Schema.String,
  publicKey: Schema.String,
  /** "Mum's Apple Watch", as the Watch named itself (bounded, cleaned). */
  name: Schema.String,
  /** Where the Watch says the key lives: a label for the record, not checked. */
  protection: Schema.Literals(["secure-enclave", "keychain", "simulator"]),
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
});
export type FamilyWatchKey = typeof WatchKey.Type;

/**
 * A device linked to one person. Its sign-in is T3's (a session whose subject names this id);
 * this record is what makes it a child's or a grown-up's, and removing it ends that at once.
 */
const Device = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["child", "grown-up"]),
  /** A child's id or a grown-up's id, by `kind`. */
  personId: Schema.String,
  name: Schema.String,
  createdAt: Schema.String,
  /** The one-time pairing link that links it, until it is used or runs out. */
  linkId: Schema.NullOr(Schema.String),
  linkExpiresAt: Schema.Number,
  passkeys: Schema.Array(Passkey),
  /** A grown-up's phone only: the paired Apple Watch that may say yes through it. */
  watch: Schema.optionalKey(WatchKey),
});
export type FamilyDevice = typeof Device.Type;

const FamilyFileV1 = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Boolean,
  childName: Schema.NullOr(Schema.String),
  codeHash: Schema.String,
  salt: Schema.String,
  createdAt: Schema.String,
  failedAttempts: Schema.Number,
  lockedUntil: Schema.NullOr(Schema.Number),
  tokenSecret: Schema.String,
  grants: Schema.Array(Grant),
});
type FamilyFileV1 = typeof FamilyFileV1.Type;

export const FAMILY_FILE_VERSION = 2;

const FamilyFile = Schema.Struct({
  version: Schema.Literal(FAMILY_FILE_VERSION),
  enabled: Schema.Boolean,
  codeHash: Schema.String,
  /**
   * How many digits the parent code has (never the code), so a grown-up's device can take the
   * code as soon as the last digit is typed. Recorded when the code is set; a file from before
   * it learns it the next time the right code is typed. Optional so older files read unchanged.
   */
  codeLength: Schema.optionalKey(Schema.Number),
  salt: Schema.String,
  createdAt: Schema.String,
  failedAttempts: Schema.Number,
  lockedUntil: Schema.NullOr(Schema.Number),
  tokenSecret: Schema.String,
  grants: Schema.Array(Grant),
  /** The household's IANA zone for bedtimes and "today"; null means the engine's own. */
  timeZone: Schema.NullOr(Schema.String),
  children: Schema.Array(Child),
  /**
   * Assistants SKYCOT can't lock down that a grown-up allowed for the Family profile with the
   * parent code (driver ids, "cursor"). Optional so files written before it read unchanged.
   */
  allowedAssistants: Schema.optionalKey(Schema.Array(Schema.String)),
  /** The grown-ups. Optional so a file from before them reads unchanged (see `withPeople`). */
  grownUps: Schema.optionalKey(Schema.Array(GrownUp)),
  /** Devices linked to a person (a child's iPad, a grown-up's phone). */
  devices: Schema.optionalKey(Schema.Array(Device)),
});
type FamilyFile = typeof FamilyFile.Type;

const decodeFamilyFileV2 = Schema.decodeUnknownOption(Schema.fromJsonString(FamilyFile));
const decodeFamilyFileV1 = Schema.decodeUnknownOption(Schema.fromJsonString(FamilyFileV1));
const encodeFamilyFile = Schema.encodeEffect(Schema.fromJsonString(FamilyFile));

export const NO_LIMITS: ChildLimits = {
  bedtime: null,
  dailyMinutes: null,
  dailyTurns: null,
  keepAllowancePercent: null,
};

/**
 * Voice typing starts off for every child, migrated ones included: in Chrome and Edge the
 * browser sends the child's voice to Google or Microsoft, so a parent turns it on knowingly
 * (Settings › Family). Read-aloud uses the Mac's own voices and starts on.
 */
export const DEFAULT_VOICE: ChildVoice = { typing: false, readAloud: true };

/**
 * The single child of a version 1 file. Its id comes from the file's own salt, so every read
 * before the first write names the same child (thread owners recorded meanwhile stay right).
 */
export function migrateFamilyFileV1(file: FamilyFileV1): FamilyFile {
  const id = `c${NodeCrypto.createHash("sha256").update(`child:${file.salt}`).digest("hex").slice(0, 10)}`;
  return {
    version: FAMILY_FILE_VERSION,
    enabled: file.enabled,
    codeHash: file.codeHash,
    salt: file.salt,
    createdAt: file.createdAt,
    failedAttempts: file.failedAttempts,
    lockedUntil: file.lockedUntil,
    tokenSecret: file.tokenSecret,
    grants: file.grants,
    timeZone: null,
    children: [
      {
        id,
        name: file.childName,
        avatar: { kind: "initial", color: AVATAR_COLORS[0] },
        look: DEFAULT_LOOK,
        largerText: true,
        voice: DEFAULT_VOICE,
        limits: NO_LIMITS,
        createdAt: file.createdAt,
      },
    ],
  };
}

/**
 * A profile from before grown-ups were people gets one: the person who set it up. Its id comes
 * from the file's own salt, so every read before the first write names the same grown-up.
 * Children, the code and everything else stay exactly as they were.
 */
export function withPeople(file: FamilyFile): FamilyFile {
  if (file.grownUps !== undefined && file.grownUps.length > 0) return file;
  const id = `g${NodeCrypto.createHash("sha256").update(`grown-up:${file.salt}`).digest("hex").slice(0, 10)}`;
  return {
    ...file,
    grownUps: [
      { id, name: null, avatar: { kind: "mascot", pose: "hello" }, createdAt: file.createdAt },
    ],
  };
}

/** Either version on disk, as version 2 with its people; null when it is neither (treated as "off"). */
export function decodeFamilyFile(raw: string): FamilyFile | null {
  const current = decodeFamilyFileV2(raw);
  if (current._tag === "Some") return withPeople(current.value);
  const legacy = decodeFamilyFileV1(raw);
  return legacy._tag === "Some" ? withPeople(migrateFamilyFileV1(legacy.value)) : null;
}

/** A linked device as any signed-in client may see it: never its passkeys' keys. */
export interface FamilyDeviceView {
  readonly id: string;
  readonly kind: FamilyDevice["kind"];
  readonly personId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly passkeys: number;
  /** The paired Apple Watch's name, when one may say yes through this phone. */
  readonly watch: string | null;
}

const deviceView = (device: FamilyDevice): FamilyDeviceView => ({
  id: device.id,
  kind: device.kind,
  personId: device.personId,
  name: device.name,
  createdAt: device.createdAt,
  passkeys: device.passkeys.length,
  watch: device.watch?.name ?? null,
});

/** What any signed-in client may read. Never the hash, salt or secret. */
export interface FamilyStatus {
  readonly enabled: boolean;
  /** The first child's name, for clients from before siblings. */
  readonly childName: string | null;
  readonly createdAt: string | null;
  readonly attemptsLeft: number;
  /** Milliseconds until code prompts open again; 0 when not locked. */
  readonly lockedForMs: number;
  readonly children: ReadonlyArray<FamilyChild>;
  /** The zone bedtimes are read in (the profile's, else the engine's). */
  readonly timeZone: string;
  /** Assistants a grown-up allowed although SKYCOT can't switch their add-ons off. */
  readonly allowedAssistants: ReadonlyArray<string>;
  /** The grown-ups (at least one while the profile is on). */
  readonly grownUps: ReadonlyArray<FamilyGrownUp>;
  /** Devices linked to a person, linked or still waiting for their link. */
  readonly devices: ReadonlyArray<FamilyDeviceView>;
}

/** What a parent sets for a child; anything left out keeps its value (or the default). */
export interface ChildInput {
  readonly name?: string | null | undefined;
  readonly avatar?: unknown;
  readonly look?: unknown;
  readonly largerText?: unknown;
  readonly voice?: unknown;
  readonly limits?: unknown;
  readonly askEachStep?: unknown;
}

export type FamilyFailureReason =
  | "not-enabled"
  | "already-enabled"
  | "invalid-code"
  | "wrong-code"
  | "locked"
  | "invalid-request"
  | "storage";

export class FamilyError extends Schema.TaggedError<FamilyError>()("SkycotFamilyError", {
  reason: Schema.Literals([
    "not-enabled",
    "already-enabled",
    "invalid-code",
    "wrong-code",
    "locked",
    "invalid-request",
    "storage",
  ]),
  attemptsLeft: Schema.optionalKey(Schema.Number),
  remainingMs: Schema.optionalKey(Schema.Number),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return familyFailureSentence(this.reason, this.attemptsLeft, this.remainingMs);
  }
}

/** Plain English for every failure; the client shows these as they are. */
export function familyFailureSentence(
  reason: FamilyFailureReason,
  attemptsLeft?: number,
  remainingMs?: number,
): string {
  switch (reason) {
    case "not-enabled":
      return "The Family profile is not on.";
    case "already-enabled":
      return "The Family profile is already on.";
    case "invalid-code":
      return "A parent code is 4 to 6 digits.";
    case "wrong-code":
      return attemptsLeft === 1
        ? "That's not the parent code. One more try before a five-minute wait."
        : `That's not the parent code. ${attemptsLeft ?? 0} tries left.`;
    case "locked": {
      const minutes = Math.max(1, Math.ceil((remainingMs ?? LOCKOUT_MS) / 60_000));
      return minutes <= 1
        ? "Too many tries. Try again in a minute."
        : `Too many tries. Try again in ${minutes} minutes.`;
    }
    case "invalid-request":
      return "That request was not understood.";
    case "storage":
      return "The engine could not save the Family profile. Try again.";
  }
}

export interface VerifyInput {
  readonly code: string;
  readonly purpose: FamilyPurpose;
  readonly sessionId: string;
  /** Required for `approve`: the one card the grown-up is allowing. */
  readonly requestId?: string | undefined;
}

export interface UnlockToken {
  readonly token: string;
  readonly expiresAt: number;
  readonly purpose: FamilyPurpose;
}

export class SkycotFamily extends Context.Service<
  SkycotFamily,
  {
    readonly status: Effect.Effect<FamilyStatus, FamilyError>;
    /**
     * How many digits the parent code has; null while the profile is off or the length is not
     * known yet (a code set before it was recorded). Only for the Mac and grown-ups' devices:
     * never part of `status`, which every device reads.
     */
    readonly codeLength: Effect.Effect<number | null>;
    /** Cheap: one stat when the file has not changed. False when the file is missing or unreadable. */
    readonly isEnabled: Effect.Effect<boolean>;
    readonly enable: (input: {
      readonly code: string;
      readonly childName: string | null;
      /** The parent's browser zone, for bedtimes; the engine's own when left out. */
      readonly timeZone?: string | null | undefined;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** One code attempt; on success records a grant for this session and returns its token. */
    readonly verify: (input: VerifyInput) => Effect.Effect<UnlockToken, FamilyError>;
    readonly disable: (input: {
      readonly code: string;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    readonly changeCode: (input: {
      readonly oldCode: string;
      readonly newCode: string;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** Renames the first child (clients from before siblings). */
    readonly rename: (input: {
      readonly childName: string | null;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    readonly addChild: (
      input: ChildInput,
    ) => Effect.Effect<{ readonly status: FamilyStatus; readonly childId: string }, FamilyError>;
    readonly updateChild: (input: {
      readonly childId: string;
      readonly patch: ChildInput;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** The last child cannot be removed: turning the profile off is the way out. */
    readonly removeChild: (input: {
      readonly childId: string;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    readonly setTimeZone: (timeZone: string) => Effect.Effect<FamilyStatus, FamilyError>;
    /**
     * One code attempt for a one-off parent action (more time tonight) that leaves no grant
     * behind. Counts towards the same five tries.
     */
    readonly checkCode: (input: { readonly code: string }) => Effect.Effect<void, FamilyError>;
    /**
     * A grown-up allows an assistant SKYCOT can't lock down (Cursor, OpenCode, …) for the
     * Family profile: one code attempt, counted like every other. Codex and Claude are refused
     * as `invalid-request`: they are locked down and need no allowance.
     */
    readonly allowAssistant: (input: {
      readonly code: string;
      readonly driver: string;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /**
     * Takes an allowance back. No code: it only makes the profile stricter. The assistant's
     * next Family turn is refused (SkycotFamilyLockdown).
     */
    readonly stopAllowingAssistant: (input: {
      readonly driver: string;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** Whether the profile is on and lists this assistant as allowed. Cheap, like `isEnabled`. */
    readonly assistantAllowed: (driver: string) => Effect.Effect<boolean>;
    /** Ends every grant this session holds (a parent leaving Advanced mode). */
    readonly lock: (input: { readonly sessionId: string }) => Effect.Effect<void, FamilyError>;
    /**
     * Whether a grown-up said yes for this session. `approve` grants are single-use and are
     * spent when `consume` is set. Always true while the profile is off.
     */
    readonly allows: (input: {
      readonly sessionId: string;
      readonly purpose: FamilyPurpose;
      readonly requestId?: string | undefined;
      readonly consume?: boolean;
    }) => Effect.Effect<boolean>;
    /** Checks a signed token (the Advanced-mode cookie). Always true while the profile is off. */
    /**
     * This session's live "yes"es, for Settings to show (Advanced mode open for 14 more
     * minutes). Single-step approvals are left out: they are spent by the card they open.
     */
    readonly openGrants: (input: {
      readonly sessionId: string;
    }) => Effect.Effect<
      ReadonlyArray<{ readonly purpose: FamilyPurpose; readonly remainingMs: number }>
    >;
    readonly tokenAllows: (
      token: string | undefined,
      purpose: FamilyPurpose,
    ) => Effect.Effect<boolean>;
    /** Ends every grant on every device (a grown-up's "Lock everything"). No code: it only takes away. */
    readonly lockAll: Effect.Effect<void, FamilyError>;
    readonly addGrownUp: (
      input: PersonInput,
    ) => Effect.Effect<{ readonly status: FamilyStatus; readonly personId: string }, FamilyError>;
    readonly updateGrownUp: (input: {
      readonly personId: string;
      readonly patch: PersonInput;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** The last grown-up stays: turning the profile off is the way out. Their devices go with them. */
    readonly removeGrownUp: (input: {
      readonly personId: string;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** The full device record, passkeys included (engine only; never sent to a client). */
    readonly device: (deviceId: string) => Effect.Effect<FamilyDevice | null>;
    /** A device waiting for its one-time link; the link itself is T3's (the caller makes it). */
    readonly addDevice: (input: {
      readonly id: string;
      readonly kind: FamilyDevice["kind"];
      readonly personId: string;
      readonly name: string | null;
      readonly linkId: string;
      readonly linkExpiresAt: number;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** Forgets a device and its passkeys; the caller ends its sign-in. */
    readonly removeDevice: (input: {
      readonly deviceId: string;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** A child's device moved to another child (the parent code, on that device or the Mac). */
    readonly reassignDevice: (input: {
      readonly deviceId: string;
      readonly childId: string;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** A grown-up's device registered a passkey (one per device is kept: a new one replaces it). */
    readonly addPasskey: (input: {
      readonly deviceId: string;
      readonly passkey: FamilyPasskey;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** A passkey was used: its counter and last use are kept, so a cloned key shows up. */
    readonly usePasskey: (input: {
      readonly deviceId: string;
      readonly passkeyId: string;
      readonly signCount: number;
    }) => Effect.Effect<void, FamilyError>;
    readonly removePasskeys: (input: {
      readonly deviceId: string;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** A grown-up's phone registered its Apple Watch's key (a new one replaces the old). */
    readonly setWatchKey: (input: {
      readonly deviceId: string;
      readonly watch: FamilyWatchKey;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** The Watch said yes: when is kept, for the devices list. */
    readonly useWatchKey: (input: {
      readonly deviceId: string;
      readonly keyId: string;
    }) => Effect.Effect<void, FamilyError>;
    readonly removeWatchKey: (input: {
      readonly deviceId: string;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
  }
>()("t3/skycot/SkycotFamily") {}

/** What a parent sets for a grown-up; anything left out keeps its value. */
export interface PersonInput {
  readonly name?: string | null | undefined;
  readonly avatar?: unknown;
}

/** A new device id: `d` and ten hex digits (people.ts `deviceIdFromSubject` reads the same shape). */
export const newDeviceId = () => `d${NodeCrypto.randomBytes(5).toString("hex")}`;

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

const hashCode = (code: string, salt: string) =>
  Effect.callback<string, FamilyError>((resume) => {
    // N=2^14 keeps one attempt around 30 ms; the lockout, not the hash, is what limits
    // guessing a six-digit code.
    NodeCrypto.scrypt(code, salt, 32, { N: 16_384, r: 8, p: 1 }, (error, key) => {
      resume(
        error
          ? Effect.fail(new FamilyError({ reason: "storage", cause: error }))
          : Effect.succeed(key.toString("hex")),
      );
    });
  });

const sameHex = (left: string, right: string) => {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && a.length > 0 && NodeCrypto.timingSafeEqual(a, b);
};

const base64Url = (text: string) => Buffer.from(text, "utf8").toString("base64url");

export function signToken(
  secret: string,
  payload: {
    readonly purpose: FamilyPurpose;
    readonly expiresAt: number;
    readonly sessionId: string;
  },
): string {
  const body = base64Url(
    JSON.stringify({ p: payload.purpose, e: payload.expiresAt, s: payload.sessionId }),
  );
  const signature = NodeCrypto.createHmac("sha256", secret)
    .update(`v1.${body}`)
    .digest("base64url");
  return `v1.${body}.${signature}`;
}

export function readToken(
  secret: string,
  token: string,
): { readonly purpose: FamilyPurpose; readonly expiresAt: number } | null {
  const [version, body, signature] = token.split(".");
  if (version !== "v1" || body === undefined || signature === undefined) return null;
  const expected = NodeCrypto.createHmac("sha256", secret).update(`v1.${body}`).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !NodeCrypto.timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const purpose = parsed["p"];
    const expiresAt = parsed["e"];
    if (
      typeof purpose !== "string" ||
      !(FAMILY_PURPOSES as ReadonlyArray<string>).includes(purpose) ||
      typeof expiresAt !== "number"
    ) {
      return null;
    }
    return { purpose: purpose as FamilyPurpose, expiresAt };
  } catch {
    return null;
  }
}

/**
 * A lock whose end lies further ahead than one lockout means the clock was moved back; cap it
 * so a changed clock can shorten nothing and lengthen a wait by at most one lockout.
 */
export function lockRemainingMs(file: Pick<FamilyFile, "lockedUntil">, now: number): number {
  if (file.lockedUntil === null) return 0;
  return Math.min(LOCKOUT_MS, Math.max(0, file.lockedUntil - now));
}

/** The engine's own zone: a Mac's clock settings, which is where the family lives. */
export function engineTimeZone(): string {
  try {
    return knownTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return "UTC";
  }
}

export function familyTimeZone(file: Pick<FamilyFile, "timeZone"> | null): string {
  return file?.timeZone ? knownTimeZone(file.timeZone) : engineTimeZone();
}

function toStatus(file: FamilyFile | null, now: number): FamilyStatus {
  if (file === null || !file.enabled) {
    return {
      enabled: false,
      childName: null,
      createdAt: null,
      attemptsLeft: MAX_ATTEMPTS,
      lockedForMs: 0,
      children: [],
      timeZone: familyTimeZone(null),
      allowedAssistants: [],
      grownUps: [],
      devices: [],
    };
  }
  const lockedForMs = lockRemainingMs(file, now);
  const failed = file.lockedUntil !== null && lockedForMs === 0 ? 0 : file.failedAttempts;
  return {
    enabled: true,
    childName: file.children[0]?.name ?? null,
    createdAt: file.createdAt,
    attemptsLeft: lockedForMs > 0 ? 0 : Math.max(0, MAX_ATTEMPTS - failed),
    lockedForMs,
    children: file.children,
    timeZone: familyTimeZone(file),
    allowedAssistants: allowedAssistantsOf(file),
    grownUps: file.grownUps ?? [],
    devices: (file.devices ?? []).map(deviceView),
  };
}

/**
 * The parent code's length when the profile is on and it is known; null otherwise (an older
 * file, or a hand-edited value no code could have). Unknown means today's behaviour: the
 * grown-up presses the button.
 */
export function knownCodeLength(
  file: Pick<FamilyFile, "enabled" | "codeLength"> | null,
): number | null {
  if (file === null || !file.enabled) return null;
  const length = file.codeLength;
  return length !== undefined && Number.isInteger(length) && length >= 4 && length <= 6
    ? length
    : null;
}

/** The file's allowed assistants, cleaned: a hand-edited file can never allow Codex or Claude. */
export function allowedAssistantsOf(file: Pick<FamilyFile, "allowedAssistants"> | null) {
  return [...new Set(file?.allowedAssistants ?? [])]
    .filter(canAllowAssistant)
    .slice(0, MAX_ALLOWED_ASSISTANTS);
}

function cleanChildName(name: string | null): string | null {
  const trimmed = name?.replace(/\s+/g, " ").trim() ?? "";
  return trimmed.length === 0 ? null : trimmed.slice(0, CHILD_NAME_MAX);
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

function cleanAvatar(value: unknown, fallback: ChildAvatar): ChildAvatar {
  const input = record(value);
  if (
    input["kind"] === "mascot" &&
    (AVATAR_POSES as ReadonlyArray<unknown>).includes(input["pose"])
  ) {
    return { kind: "mascot", pose: input["pose"] as (typeof AVATAR_POSES)[number] };
  }
  if (
    input["kind"] === "initial" &&
    (AVATAR_COLORS as ReadonlyArray<unknown>).includes(input["color"])
  ) {
    return { kind: "initial", color: input["color"] as (typeof AVATAR_COLORS)[number] };
  }
  return fallback;
}

function cleanLook(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value) ? value : fallback;
}

function boundedOrNull(value: unknown, bounds: { readonly min: number; readonly max: number }) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

/** A parent's limits, normalised: "7:30" → "07:30", numbers clamped, nonsense left unchanged. */
export function cleanLimits(value: unknown, previous: ChildLimits): ChildLimits {
  const input = record(value);
  const pick = <K extends keyof ChildLimits>(key: K, next: ChildLimits[K] | undefined) =>
    key in input && next !== undefined ? next : previous[key];
  const bedtimeInput = input["bedtime"];
  let bedtime: ChildLimits["bedtime"] | undefined;
  if (bedtimeInput === null) bedtime = null;
  else {
    const window = record(bedtimeInput);
    const start = typeof window["start"] === "string" ? parseClockTime(window["start"]) : null;
    const end = typeof window["end"] === "string" ? parseClockTime(window["end"]) : null;
    bedtime =
      start !== null && end !== null && start !== end
        ? { start: formatClockTime(start), end: formatClockTime(end) }
        : undefined;
  }
  return {
    bedtime: pick("bedtime", bedtime),
    dailyMinutes: pick(
      "dailyMinutes",
      boundedOrNull(input["dailyMinutes"], LIMIT_BOUNDS.dailyMinutes),
    ),
    dailyTurns: pick("dailyTurns", boundedOrNull(input["dailyTurns"], LIMIT_BOUNDS.dailyTurns)),
    keepAllowancePercent: pick(
      "keepAllowancePercent",
      boundedOrNull(input["keepAllowancePercent"], LIMIT_BOUNDS.keepAllowancePercent),
    ),
  };
}

function cleanVoice(value: unknown, previous: ChildVoice): ChildVoice {
  const input = record(value);
  return {
    typing: typeof input["typing"] === "boolean" ? input["typing"] : previous.typing,
    readAloud: typeof input["readAloud"] === "boolean" ? input["readAloud"] : previous.readAloud,
  };
}

/** One child with a parent's changes applied; every field is checked, nothing is trusted. */
export function applyChildInput(child: FamilyChild, input: ChildInput): FamilyChild {
  return {
    ...child,
    name: input.name === undefined ? child.name : cleanChildName(input.name),
    avatar: input.avatar === undefined ? child.avatar : cleanAvatar(input.avatar, child.avatar),
    look: input.look === undefined ? child.look : cleanLook(input.look, child.look),
    largerText: typeof input.largerText === "boolean" ? input.largerText : child.largerText,
    voice: input.voice === undefined ? child.voice : cleanVoice(input.voice, child.voice),
    limits: input.limits === undefined ? child.limits : cleanLimits(input.limits, child.limits),
    ...(typeof input.askEachStep === "boolean" ? { askEachStep: input.askEachStep } : {}),
  };
}

function newChild(input: ChildInput, siblings: number, createdAt: string): FamilyChild {
  return applyChildInput(
    {
      id: `c${hex(NodeCrypto.randomBytes(5))}`,
      name: null,
      // Each new sibling gets the next colour, so two letter pictures never look alike.
      avatar: { kind: "initial", color: AVATAR_COLORS[siblings % AVATAR_COLORS.length]! },
      look: DEFAULT_LOOK,
      largerText: true,
      voice: DEFAULT_VOICE,
      limits: NO_LIMITS,
      createdAt,
    },
    input,
  );
}

function applyPersonInput(person: FamilyGrownUp, input: PersonInput): FamilyGrownUp {
  return {
    ...person,
    name: input.name === undefined ? person.name : cleanName(input.name, PERSON_NAME_MAX),
    avatar: input.avatar === undefined ? person.avatar : cleanAvatar(input.avatar, person.avatar),
  };
}

function newGrownUp(input: PersonInput, others: number, createdAt: string): FamilyGrownUp {
  return applyPersonInput(
    {
      id: `g${hex(NodeCrypto.randomBytes(5))}`,
      name: null,
      avatar: { kind: "initial", color: AVATAR_COLORS[(others + 3) % AVATAR_COLORS.length]! },
      createdAt,
    },
    input,
  );
}

/** A grown-up's device is only as trusted as the code that linked it: a new code unlinks them. */
const childDevicesOnly = (devices: ReadonlyArray<FamilyDevice> | undefined) =>
  (devices ?? []).filter((device) => device.kind === "child");

const liveGrants = (grants: ReadonlyArray<Grant>, now: number) =>
  grants.filter((grant) => grant.expiresAt > now);

const makeAt = Effect.fn("SkycotFamily.make")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lock = yield* Semaphore.make(1);
  const cache = yield* Ref.make<{ readonly stamp: string; readonly file: FamilyFile | null }>({
    stamp: "",
    file: null,
  });

  // Unreadable or missing means "off": a corrupt file must never lock the parent out of
  // their own Mac, and deleting the file is the documented last-resort reset.
  const load = Effect.gen(function* () {
    const info = yield* fs.stat(filePath).pipe(Effect.orElseSucceed(() => null));
    if (info === null) {
      yield* Ref.set(cache, { stamp: "missing", file: null });
      return null;
    }
    const mtime = info.mtime._tag === "Some" ? info.mtime.value.getTime() : 0;
    const stamp = `${mtime}:${info.size}`;
    const cached = yield* Ref.get(cache);
    if (cached.stamp === stamp) return cached.file;
    const raw = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
    const file = decodeFamilyFile(raw);
    yield* Ref.set(cache, { stamp, file });
    return file;
  });

  const save = Effect.fn("SkycotFamily.save")(
    function* (file: FamilyFile | null) {
      if (file === null) {
        yield* fs.remove(filePath, { force: true });
      } else {
        yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
        const temp = `${filePath}.${hex(NodeCrypto.randomBytes(6))}.tmp`;
        yield* fs.writeFileString(temp, `${yield* encodeFamilyFile(file)}\n`, { mode: 0o600 });
        yield* fs.rename(temp, filePath);
      }
      // Force the next load to re-read: two writes inside one mtime tick must not be missed.
      yield* Ref.set(cache, { stamp: "", file: null });
    },
    Effect.mapError((cause) => new FamilyError({ reason: "storage", cause })),
  );

  const now = Clock.currentTimeMillis;

  /**
   * One attempt against the stored hash, with the counter and lockout written back. Runs
   * under the lock so two tabs cannot each get five tries.
   */
  const attempt = Effect.fn("SkycotFamily.attempt")(function* (
    file: FamilyFile,
    code: string,
    at: number,
  ) {
    const remaining = lockRemainingMs(file, at);
    if (remaining > 0) {
      return yield* new FamilyError({ reason: "locked", remainingMs: remaining, attemptsLeft: 0 });
    }
    // A lockout that has run out starts the count again.
    const base: FamilyFile =
      file.lockedUntil !== null ? { ...file, failedAttempts: 0, lockedUntil: null } : file;
    const matches =
      CODE_PATTERN.test(code) && sameHex(yield* hashCode(code, base.salt), base.codeHash);
    if (matches) {
      // The right code also teaches a file from before `codeLength` how long the code is.
      const cleared: FamilyFile = {
        ...base,
        failedAttempts: 0,
        lockedUntil: null,
        codeLength: code.length,
      };
      return cleared;
    }
    const failedAttempts = base.failedAttempts + 1;
    if (failedAttempts >= MAX_ATTEMPTS) {
      yield* save({ ...base, failedAttempts, lockedUntil: at + LOCKOUT_MS });
      return yield* new FamilyError({ reason: "locked", remainingMs: LOCKOUT_MS, attemptsLeft: 0 });
    }
    yield* save({ ...base, failedAttempts });
    return yield* new FamilyError({
      reason: "wrong-code",
      attemptsLeft: MAX_ATTEMPTS - failedAttempts,
    });
  });

  const requireEnabled = (file: FamilyFile | null) =>
    file === null || !file.enabled
      ? Effect.fail(new FamilyError({ reason: "not-enabled" }))
      : Effect.succeed(file);

  const status: SkycotFamily["Service"]["status"] = Effect.gen(function* () {
    return toStatus(yield* load, yield* now);
  }).pipe(Effect.withSpan("SkycotFamily.status"));

  const codeLength: SkycotFamily["Service"]["codeLength"] = load.pipe(
    Effect.map((file) => knownCodeLength(file)),
    Effect.orElseSucceed(() => null),
  );

  const isEnabled: SkycotFamily["Service"]["isEnabled"] = load.pipe(
    Effect.map((file) => file !== null && file.enabled),
  );

  const enable: SkycotFamily["Service"]["enable"] = Effect.fn("SkycotFamily.enable")(function* (
    input,
  ) {
    if (!CODE_PATTERN.test(input.code)) return yield* new FamilyError({ reason: "invalid-code" });
    const existing = yield* load;
    if (existing !== null && existing.enabled) {
      return yield* new FamilyError({ reason: "already-enabled" });
    }
    const at = yield* now;
    const salt = hex(NodeCrypto.randomBytes(16));
    const createdAt = DateTime.formatIso(DateTime.makeUnsafe(at));
    const file: FamilyFile = {
      version: FAMILY_FILE_VERSION,
      enabled: true,
      codeHash: yield* hashCode(input.code, salt),
      codeLength: input.code.length,
      salt,
      createdAt,
      failedAttempts: 0,
      lockedUntil: null,
      tokenSecret: hex(NodeCrypto.randomBytes(32)),
      grants: [],
      timeZone: input.timeZone ? knownTimeZone(input.timeZone) : null,
      children: [newChild({ name: input.childName }, 0, createdAt)],
      // The person setting the profile up is its first grown-up.
      grownUps: [newGrownUp({}, 0, createdAt)],
      devices: [],
    };
    yield* save(file);
    return toStatus(file, at);
  }, lock.withPermits(1));

  const verify: SkycotFamily["Service"]["verify"] = Effect.fn("SkycotFamily.verify")(function* (
    input,
  ) {
    if (!(FAMILY_PURPOSES as ReadonlyArray<string>).includes(input.purpose)) {
      return yield* new FamilyError({ reason: "invalid-request" });
    }
    if (input.purpose === "approve" && !input.requestId) {
      return yield* new FamilyError({ reason: "invalid-request" });
    }
    const file = yield* requireEnabled(yield* load);
    const at = yield* now;
    const cleared = yield* attempt(file, input.code, at);
    const expiresAt = at + GRANT_TTL_MS[input.purpose];
    const grant: Grant = {
      sessionId: input.sessionId,
      purpose: input.purpose,
      ...(input.purpose === "approve" && input.requestId ? { requestId: input.requestId } : {}),
      expiresAt,
    };
    yield* save({ ...cleared, grants: [...liveGrants(cleared.grants, at), grant] });
    return {
      token: signToken(cleared.tokenSecret, {
        purpose: input.purpose,
        expiresAt,
        sessionId: input.sessionId,
      }),
      expiresAt,
      purpose: input.purpose,
    } satisfies UnlockToken;
  }, lock.withPermits(1));

  const disable: SkycotFamily["Service"]["disable"] = Effect.fn("SkycotFamily.disable")(function* (
    input,
  ) {
    const file = yield* requireEnabled(yield* load);
    const at = yield* now;
    yield* attempt(file, input.code, at);
    // Off forgets everything, the child's name included: nothing lingers for the next person.
    yield* save(null);
    return toStatus(null, at);
  }, lock.withPermits(1));

  const changeCode: SkycotFamily["Service"]["changeCode"] = Effect.fn("SkycotFamily.changeCode")(
    function* (input) {
      if (!CODE_PATTERN.test(input.newCode)) {
        return yield* new FamilyError({ reason: "invalid-code" });
      }
      const file = yield* requireEnabled(yield* load);
      const at = yield* now;
      const cleared = yield* attempt(file, input.oldCode, at);
      const salt = hex(NodeCrypto.randomBytes(16));
      const next: FamilyFile = {
        ...cleared,
        salt,
        codeHash: yield* hashCode(input.newCode, salt),
        codeLength: input.newCode.length,
        // A new code ends every grant and token issued under the old one, and unlinks every
        // grown-up's device (it may have been linked by whoever learned the old code). Children's
        // devices stay: they can do nothing a grown-up's code is needed for.
        tokenSecret: hex(NodeCrypto.randomBytes(32)),
        grants: [],
        devices: childDevicesOnly(cleared.devices),
      };
      yield* save(next);
      return toStatus(next, at);
    },
    lock.withPermits(1),
  );

  const rename: SkycotFamily["Service"]["rename"] = Effect.fn("SkycotFamily.rename")(function* (
    input,
  ) {
    const file = yield* requireEnabled(yield* load);
    const next: FamilyFile = {
      ...file,
      children: file.children.map((child, index) =>
        index === 0 ? applyChildInput(child, { name: input.childName }) : child,
      ),
    };
    yield* save(next);
    return toStatus(next, yield* now);
  }, lock.withPermits(1));

  const addChild: SkycotFamily["Service"]["addChild"] = Effect.fn("SkycotFamily.addChild")(
    function* (input) {
      const file = yield* requireEnabled(yield* load);
      if (file.children.length >= MAX_CHILDREN) {
        return yield* new FamilyError({ reason: "invalid-request" });
      }
      const at = yield* now;
      const child = newChild(
        input,
        file.children.length,
        DateTime.formatIso(DateTime.makeUnsafe(at)),
      );
      const next: FamilyFile = { ...file, children: [...file.children, child] };
      yield* save(next);
      return { status: toStatus(next, at), childId: child.id };
    },
    lock.withPermits(1),
  );

  const updateChild: SkycotFamily["Service"]["updateChild"] = Effect.fn("SkycotFamily.updateChild")(
    function* (input) {
      const file = yield* requireEnabled(yield* load);
      if (!file.children.some((child) => child.id === input.childId)) {
        return yield* new FamilyError({ reason: "invalid-request" });
      }
      const next: FamilyFile = {
        ...file,
        children: file.children.map((child) =>
          child.id === input.childId ? applyChildInput(child, input.patch) : child,
        ),
      };
      yield* save(next);
      return toStatus(next, yield* now);
    },
    lock.withPermits(1),
  );

  const removeChild: SkycotFamily["Service"]["removeChild"] = Effect.fn("SkycotFamily.removeChild")(
    function* (input) {
      const file = yield* requireEnabled(yield* load);
      if (file.children.length <= 1 || !file.children.some((child) => child.id === input.childId)) {
        return yield* new FamilyError({ reason: "invalid-request" });
      }
      const next: FamilyFile = {
        ...file,
        children: file.children.filter((child) => child.id !== input.childId),
        // That child's devices go with them.
        devices: (file.devices ?? []).filter(
          (device) => !(device.kind === "child" && device.personId === input.childId),
        ),
      };
      yield* save(next);
      return toStatus(next, yield* now);
    },
    lock.withPermits(1),
  );

  const setTimeZone: SkycotFamily["Service"]["setTimeZone"] = Effect.fn("SkycotFamily.setTimeZone")(
    function* (timeZone) {
      const file = yield* requireEnabled(yield* load);
      const zone = knownTimeZone(timeZone);
      if (file.timeZone === zone) return toStatus(file, yield* now);
      const next: FamilyFile = { ...file, timeZone: zone };
      yield* save(next);
      return toStatus(next, yield* now);
    },
    lock.withPermits(1),
  );

  const checkCode: SkycotFamily["Service"]["checkCode"] = Effect.fn("SkycotFamily.checkCode")(
    function* (input) {
      const file = yield* requireEnabled(yield* load);
      const at = yield* now;
      const cleared = yield* attempt(file, input.code, at);
      // Only a success after earlier misses changes the file (the counter goes back to zero),
      // or the first success that learns the code's length.
      if (
        cleared.failedAttempts !== file.failedAttempts ||
        cleared.lockedUntil !== file.lockedUntil ||
        cleared.codeLength !== file.codeLength
      ) {
        yield* save(cleared);
      }
    },
    lock.withPermits(1),
  );

  const allowAssistant: SkycotFamily["Service"]["allowAssistant"] = Effect.fn(
    "SkycotFamily.allowAssistant",
  )(function* (input) {
    if (!canAllowAssistant(input.driver)) {
      return yield* new FamilyError({ reason: "invalid-request" });
    }
    const file = yield* requireEnabled(yield* load);
    const at = yield* now;
    const cleared = yield* attempt(file, input.code, at);
    const allowed = allowedAssistantsOf(cleared);
    if (!allowed.includes(input.driver) && allowed.length >= MAX_ALLOWED_ASSISTANTS) {
      return yield* new FamilyError({ reason: "invalid-request" });
    }
    const next: FamilyFile = {
      ...cleared,
      allowedAssistants: allowed.includes(input.driver) ? allowed : [...allowed, input.driver],
    };
    yield* save(next);
    yield* Effect.logInfo("skycot-family.assistant-allowed", { driver: input.driver });
    return toStatus(next, at);
  }, lock.withPermits(1));

  const stopAllowingAssistant: SkycotFamily["Service"]["stopAllowingAssistant"] = Effect.fn(
    "SkycotFamily.stopAllowingAssistant",
  )(function* (input) {
    const file = yield* requireEnabled(yield* load);
    const allowed = allowedAssistantsOf(file);
    if (!allowed.includes(input.driver)) return toStatus(file, yield* now);
    const next: FamilyFile = {
      ...file,
      allowedAssistants: allowed.filter((driver) => driver !== input.driver),
    };
    yield* save(next);
    yield* Effect.logInfo("skycot-family.assistant-no-longer-allowed", { driver: input.driver });
    return toStatus(next, yield* now);
  }, lock.withPermits(1));

  const assistantAllowed: SkycotFamily["Service"]["assistantAllowed"] = (driver) =>
    load.pipe(
      Effect.map(
        (file) => file !== null && file.enabled && allowedAssistantsOf(file).includes(driver),
      ),
    );

  const lockSession: SkycotFamily["Service"]["lock"] = Effect.fn("SkycotFamily.lock")(function* (
    input,
  ) {
    const file = yield* load;
    if (file === null || !file.enabled) return;
    const at = yield* now;
    yield* save({
      ...file,
      grants: liveGrants(file.grants, at).filter((grant) => grant.sessionId !== input.sessionId),
    });
  }, lock.withPermits(1));

  const allows: SkycotFamily["Service"]["allows"] = Effect.fn("SkycotFamily.allows")(function* (
    input,
  ) {
    const file = yield* load;
    if (file === null || !file.enabled) return true;
    const at = yield* now;
    const live = liveGrants(file.grants, at);
    const forSession = live.filter((grant) => grant.sessionId === input.sessionId);
    if (forSession.some((grant) => grant.purpose === "advanced")) return true;
    const match = forSession.find(
      (grant) =>
        grant.purpose === input.purpose &&
        (input.purpose !== "approve" || grant.requestId === input.requestId),
    );
    if (match === undefined) return false;
    if (input.consume === true && input.purpose === "approve") {
      yield* save({ ...file, grants: live.filter((grant) => grant !== match) }).pipe(
        Effect.ignoreCause({ log: true, message: "Could not spend a Family approval grant." }),
      );
    }
    return true;
  }, lock.withPermits(1));

  const openGrants: SkycotFamily["Service"]["openGrants"] = Effect.fn("SkycotFamily.openGrants")(
    function* (input) {
      const file = yield* load;
      if (file === null || !file.enabled) return [];
      const at = yield* now;
      return liveGrants(file.grants, at)
        .filter((grant) => grant.sessionId === input.sessionId && grant.purpose !== "approve")
        .map((grant) => ({ purpose: grant.purpose, remainingMs: grant.expiresAt - at }));
    },
  );

  const tokenAllows: SkycotFamily["Service"]["tokenAllows"] = Effect.fn("SkycotFamily.tokenAllows")(
    function* (token, purpose) {
      const file = yield* load;
      if (file === null || !file.enabled) return true;
      if (token === undefined || token.length === 0) return false;
      const read = readToken(file.tokenSecret, token);
      if (read === null) return false;
      return (
        read.expiresAt > (yield* now) && (read.purpose === purpose || read.purpose === "advanced")
      );
    },
  );

  const lockAll: SkycotFamily["Service"]["lockAll"] = Effect.gen(function* () {
    const file = yield* load;
    if (file === null || !file.enabled || file.grants.length === 0) return;
    yield* save({ ...file, grants: [] });
  }).pipe(lock.withPermits(1), Effect.withSpan("SkycotFamily.lockAll"));

  /** One change to the people or devices, under the lock, with the profile on. */
  const changeOnce = Effect.fn("SkycotFamily.change")(function* (
    run: (
      file: FamilyFile,
      at: number,
    ) => Effect.Effect<readonly [FamilyFile, unknown], FamilyError>,
  ) {
    const file = yield* requireEnabled(yield* load);
    const at = yield* now;
    const [next, result] = yield* run(file, at);
    if (next !== file) yield* save(next);
    return { status: toStatus(next, at), result };
  }, lock.withPermits(1));
  const change = <A>(
    name: string,
    run: (file: FamilyFile, at: number) => Effect.Effect<readonly [FamilyFile, A], FamilyError>,
  ) =>
    changeOnce(run).pipe(
      Effect.map(({ status, result }) => ({ status, result: result as A })),
      Effect.annotateSpans({ "skycot.family.change": name }),
    );

  const invalid = () => Effect.fail(new FamilyError({ reason: "invalid-request" }));

  const addGrownUp: SkycotFamily["Service"]["addGrownUp"] = (input) =>
    change("addGrownUp", (file, at) => {
      const people = file.grownUps ?? [];
      if (people.length >= MAX_GROWN_UPS) return invalid();
      const person = newGrownUp(input, people.length, DateTime.formatIso(DateTime.makeUnsafe(at)));
      return Effect.succeed([{ ...file, grownUps: [...people, person] }, person.id] as const);
    }).pipe(Effect.map(({ status, result }) => ({ status, personId: result })));

  const updateGrownUp: SkycotFamily["Service"]["updateGrownUp"] = (input) =>
    change("updateGrownUp", (file) => {
      const people = file.grownUps ?? [];
      if (!people.some((person) => person.id === input.personId)) return invalid();
      return Effect.succeed([
        {
          ...file,
          grownUps: people.map((person) =>
            person.id === input.personId ? applyPersonInput(person, input.patch) : person,
          ),
        },
        null,
      ] as const);
    }).pipe(Effect.map(({ status }) => status));

  const removeGrownUp: SkycotFamily["Service"]["removeGrownUp"] = (input) =>
    change("removeGrownUp", (file) => {
      const people = file.grownUps ?? [];
      if (people.length <= 1 || !people.some((person) => person.id === input.personId)) {
        return invalid();
      }
      return Effect.succeed([
        {
          ...file,
          grownUps: people.filter((person) => person.id !== input.personId),
          devices: (file.devices ?? []).filter(
            (device) => !(device.kind === "grown-up" && device.personId === input.personId),
          ),
        },
        null,
      ] as const);
    }).pipe(Effect.map(({ status }) => status));

  const device: SkycotFamily["Service"]["device"] = (deviceId) =>
    load.pipe(
      Effect.map((file) =>
        file === null || !file.enabled
          ? null
          : ((file.devices ?? []).find((candidate) => candidate.id === deviceId) ?? null),
      ),
    );

  const addDevice: SkycotFamily["Service"]["addDevice"] = (input) =>
    change("addDevice", (file, at) => {
      const devices = file.devices ?? [];
      const personKnown =
        input.kind === "child"
          ? file.children.some((child) => child.id === input.personId)
          : (file.grownUps ?? []).some((person) => person.id === input.personId);
      if (
        !personKnown ||
        devices.length >= MAX_DEVICES ||
        devices.some((existing) => existing.id === input.id)
      ) {
        return invalid();
      }
      const added: FamilyDevice = {
        id: input.id,
        kind: input.kind,
        personId: input.personId,
        name: cleanName(input.name, DEVICE_NAME_MAX) ?? "A device",
        createdAt: DateTime.formatIso(DateTime.makeUnsafe(at)),
        linkId: input.linkId,
        linkExpiresAt: input.linkExpiresAt,
        passkeys: [],
      };
      return Effect.succeed([{ ...file, devices: [...devices, added] }, null] as const);
    }).pipe(Effect.map(({ status }) => status));

  const removeDevice: SkycotFamily["Service"]["removeDevice"] = (input) =>
    change("removeDevice", (file) => {
      const devices = file.devices ?? [];
      if (!devices.some((existing) => existing.id === input.deviceId)) {
        return Effect.succeed([file, null] as const);
      }
      return Effect.succeed([
        { ...file, devices: devices.filter((existing) => existing.id !== input.deviceId) },
        null,
      ] as const);
    }).pipe(Effect.map(({ status }) => status));

  const updateDevice = (
    name: string,
    deviceId: string,
    update: (device: FamilyDevice, file: FamilyFile, at: number) => FamilyDevice | null,
  ) =>
    change(name, (file, at) => {
      const devices = file.devices ?? [];
      const current = devices.find((existing) => existing.id === deviceId);
      if (current === undefined) return invalid();
      const next = update(current, file, at);
      if (next === null) return invalid();
      return Effect.succeed([
        {
          ...file,
          devices: devices.map((existing) => (existing.id === deviceId ? next : existing)),
        },
        null,
      ] as const);
    }).pipe(Effect.map(({ status }) => status));

  const reassignDevice: SkycotFamily["Service"]["reassignDevice"] = (input) =>
    updateDevice("reassignDevice", input.deviceId, (current, file) =>
      current.kind === "child" && file.children.some((child) => child.id === input.childId)
        ? { ...current, personId: input.childId }
        : null,
    );

  const addPasskey: SkycotFamily["Service"]["addPasskey"] = (input) =>
    updateDevice("addPasskey", input.deviceId, (current) =>
      current.kind === "grown-up" ? { ...current, passkeys: [input.passkey] } : null,
    );

  const usePasskey: SkycotFamily["Service"]["usePasskey"] = (input) =>
    updateDevice("usePasskey", input.deviceId, (current, _file, at) =>
      current.passkeys.some((passkey) => passkey.id === input.passkeyId)
        ? {
            ...current,
            passkeys: current.passkeys.map((passkey) =>
              passkey.id === input.passkeyId
                ? {
                    ...passkey,
                    signCount: input.signCount,
                    lastUsedAt: DateTime.formatIso(DateTime.makeUnsafe(at)),
                  }
                : passkey,
            ),
          }
        : null,
    ).pipe(Effect.asVoid);

  const removePasskeys: SkycotFamily["Service"]["removePasskeys"] = (input) =>
    updateDevice("removePasskeys", input.deviceId, (current) => ({ ...current, passkeys: [] }));

  const setWatchKey: SkycotFamily["Service"]["setWatchKey"] = (input) =>
    updateDevice("setWatchKey", input.deviceId, (current) =>
      current.kind === "grown-up" ? { ...current, watch: input.watch } : null,
    );

  const useWatchKey: SkycotFamily["Service"]["useWatchKey"] = (input) =>
    updateDevice("useWatchKey", input.deviceId, (current, _file, at) =>
      current.watch !== undefined && current.watch.id === input.keyId
        ? {
            ...current,
            watch: { ...current.watch, lastUsedAt: DateTime.formatIso(DateTime.makeUnsafe(at)) },
          }
        : null,
    ).pipe(Effect.asVoid);

  const removeWatchKey: SkycotFamily["Service"]["removeWatchKey"] = (input) =>
    updateDevice("removeWatchKey", input.deviceId, (current) => {
      const { watch: _gone, ...rest } = current;
      return rest;
    });

  return SkycotFamily.of({
    lockAll,
    codeLength,
    addGrownUp,
    updateGrownUp,
    removeGrownUp,
    device,
    addDevice,
    removeDevice,
    reassignDevice,
    addPasskey,
    usePasskey,
    removePasskeys,
    setWatchKey,
    useWatchKey,
    removeWatchKey,
    status,
    openGrants,
    isEnabled,
    enable,
    verify,
    disable,
    changeCode,
    rename,
    addChild,
    updateChild,
    removeChild,
    setTimeZone,
    checkCode,
    allowAssistant,
    stopAllowingAssistant,
    assistantAllowed,
    lock: lockSession,
    allows,
    tokenAllows,
  });
});

/** For tests and tools: a profile file at an explicit path. */
export const layerAt = (filePath: string) => Layer.effect(SkycotFamily, makeAt(filePath));

/** The engine's profile, in `<T3 home>/userdata/skycot-family.json`. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return layerAt(path.join(config.stateDir, FAMILY_FILE_NAME));
  }),
);
