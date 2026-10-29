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
import {
  cleanPagePath,
  cleanSites,
  MAX_PAGE_ENTRIES,
  MAX_PAGE_SITES,
  sitesForPage,
  withAllowed,
  type PageInternetEntry,
} from "@t3tools/skycot-rules/page-internet";
import { PROJECT_APPROVAL_COVERS, type ProjectApprovalCover } from "@t3tools/skycot-rules/family";

export const FAMILY_FILE_NAME = "skycot-family.json";
export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 5 * 60_000;
export const CODE_PATTERN = /^\d{4,6}$/;
export const CHILD_NAME_MAX = 40;
export const MAX_CHILDREN = 8;
export const DEFAULT_LOOK = "workshop";
// nondev-seam: skycot-page-internet-ask-storage
export const PAGE_INTERNET_ASK_TTL_MS = 30 * 60_000;
export const MAX_PAGE_INTERNET_ASKS = 50;

const PageInternetAsk = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  childId: Schema.String,
  page: Schema.String,
  sites: Schema.Array(Schema.String),
  createdAt: Schema.Number,
  expiresAt: Schema.Number,
  status: Schema.Literals(["pending", "allowed", "declined", "superseded"]),
});
export type PageInternetAsk = typeof PageInternetAsk.Type;

// nondev-seam: skycot-project-approval-grants
const ProjectApprovalGrant = Schema.Struct({
  id: Schema.String,
  childId: Schema.String,
  projectPath: Schema.String,
  covers: Schema.Array(Schema.Literals(PROJECT_APPROVAL_COVERS)),
  grantedBy: Schema.String,
  how: Schema.Literals(["parent-code", "face-id", "watch", "grown-up-session"]),
  createdAt: Schema.Number,
  expiresAt: Schema.Number,
});
export type ProjectApprovalGrant = typeof ProjectApprovalGrant.Type;
export const PROJECT_APPROVAL_TTL_MS = 30 * 24 * 60 * 60_000;
export const MAX_PROJECT_APPROVAL_GRANTS = 200;

// nondev-seam: skycot-project-put-away
/** A project put away (hidden from the children's lists) and who did it; a grown-up brings it back. */
const ProjectArchive = Schema.Struct({
  projectId: Schema.String,
  childId: Schema.NullOr(Schema.String),
  archivedAt: Schema.Number,
  by: Schema.Literals(["child", "grown-up"]),
});
export type ProjectArchive = typeof ProjectArchive.Type;
export const MAX_PROJECT_ARCHIVES = 500;
/** Developer projects a grown-up switched on for the kids ("For the kids"). */
export const MAX_KIDS_VISIBLE_PROJECTS = 500;
/** How long after putting a project away the child may take it back on their own (the Undo). */
export const PROJECT_UNDO_WINDOW_MS = 15_000;

/** The mascot's poses a child can pick as their picture (apps/nondev features/brand/Mascot). */
export const AVATAR_POSES = [
  "hello",
  "yay",
  "thinking",
  "oops",
  "ask-a-grown-up",
  "night-night",
] as const;
/** SKYCOT's drawn characters a person can pick as their picture (apps/nondev features/family/characters.ts). */
export const AVATAR_CHARACTERS = [
  "cloud",
  "sun",
  "moon",
  "star",
  "rocket",
  "cat",
  "dog",
  "dino",
  "robot",
  "penguin",
  "fox",
  "owl",
  "whale",
  "unicorn",
  "octopus",
  "planet",
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
 * What a grown-up can say yes to. The shared grown-up session covers the listed actions; update
 * restarts and exact-request approvals keep their own short grants.
 */
export const FAMILY_PURPOSES = [
  // nondev-seam: skycot-grown-up-session-grants
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
  "grownUpSession",
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
  grownUpSession: 15 * 60_000,
};
export const GROWN_UP_SESSION_MAX_MS = 2 * 60 * 60_000;

export const UNLOCK_COOKIE_NAME = "skycot_family_unlock";
/** The same proof as the cookie, for pages on another origin (the Mac app) that cannot send it. */
export const UNLOCK_HEADER_NAME = "x-skycot-family-unlock";

// nondev-seam: skycot-grown-up-session-grants
const Grant = Schema.Struct({
  sessionId: Schema.String,
  purpose: Schema.Literals(FAMILY_PURPOSES),
  requestId: Schema.optionalKey(Schema.String),
  scope: Schema.optionalKey(Schema.Literal("project")),
  how: Schema.optionalKey(Schema.Literals(["parent-code", "grown-up-session"])),
  expiresAt: Schema.Number,
  startedAt: Schema.optionalKey(Schema.Number),
  renewals: Schema.optionalKey(Schema.Number),
});
type Grant = typeof Grant.Type;

const ChildAvatar = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("mascot"), pose: Schema.Literals(AVATAR_POSES) }),
  Schema.Struct({ kind: Schema.Literal("initial"), color: Schema.Literals(AVATAR_COLORS) }),
  Schema.Struct({ kind: Schema.Literal("character"), id: Schema.Literals(AVATAR_CHARACTERS) }),
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

export const READING_LEVELS = ["little-makers", "makers", "big-makers"] as const;
export type ReadingLevel = (typeof READING_LEVELS)[number];
export const DEFAULT_READING_LEVEL: ReadingLevel = "makers";

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
  readingLevel: Schema.optionalKey(Schema.Literals(READING_LEVELS)),
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
 * A grown-up's phone's own Face ID key (or Touch ID, on an iPad): a P-256 key made in that
 * phone's Secure Enclave, usable only after Face ID for each signature. The public half only
 * (SPKI DER, base64url). One per device; setting it up again replaces it; "Stop using Face ID"
 * and removing the device forget it.
 */
const DeviceKey = Schema.Struct({
  id: Schema.String,
  publicKey: Schema.String,
  /** Which of Apple's checks guards it, as the phone says: words for the log, not checked. */
  biometry: Schema.Literals(["face-id", "touch-id", "optic-id"]),
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
});
export type FamilyDeviceKey = typeof DeviceKey.Type;

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
  /** A grown-up's device only: its own Face ID key, for saying yes on the device itself. */
  deviceKey: Schema.optionalKey(DeviceKey),
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
  /**
   * "Trusted add-ons download by themselves" (Settings › Family, parent code to change). Absent
   * means on: the default, and what files written before it get.
   */
  trustedAddOns: Schema.optionalKey(Schema.Boolean),
  /** The grown-ups. Optional so a file from before them reads unchanged (see `withPeople`). */
  grownUps: Schema.optionalKey(Schema.Array(GrownUp)),
  /** Devices linked to a person (a child's iPad, a grown-up's phone). */
  devices: Schema.optionalKey(Schema.Array(Device)),
  /**
   * Pages a grown-up allowed to load things from internet sites (@t3tools/skycot-rules/page-internet).
   * Optional so files written before it read unchanged.
   */
  pageInternet: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ page: Schema.String, sites: Schema.Array(Schema.String), at: Schema.Number }),
    ),
  ),
  /** Bounded requests to allow one page's exact internet sites. */
  pageInternetAsks: Schema.optionalKey(Schema.Array(PageInternetAsk)),
  /** Project-scoped approvals; optional so older Family files continue to load. */
  projectApprovalGrants: Schema.optionalKey(Schema.Array(ProjectApprovalGrant)),
  /** Projects put away; optional so older Family files continue to load. */
  projectArchives: Schema.optionalKey(Schema.Array(ProjectArchive)),
  /** Developer projects shown to the children; optional like the rest. */
  kidsVisibleProjects: Schema.optionalKey(Schema.Array(Schema.String)),
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
  /** Whether this grown-up's device may say yes with its own Face ID key. */
  readonly faceId: boolean;
}

const deviceView = (device: FamilyDevice): FamilyDeviceView => ({
  id: device.id,
  kind: device.kind,
  personId: device.personId,
  name: device.name,
  createdAt: device.createdAt,
  passkeys: device.passkeys.length,
  watch: device.watch?.name ?? null,
  faceId: device.deviceKey !== undefined,
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
  /** Trusted add-ons (three.js, p5, …) download without a grown-up. Off while the profile is off. */
  readonly trustedAddOns: boolean;
  /** The grown-ups (at least one while the profile is on). */
  readonly grownUps: ReadonlyArray<FamilyGrownUp>;
  /** Devices linked to a person, linked or still waiting for their link. */
  readonly devices: ReadonlyArray<FamilyDeviceView>;
  /** Pages allowed to load things from internet sites (Settings › Family lists them). */
  readonly pageInternet: ReadonlyArray<PageInternetEntry>;
  readonly projectApprovalGrants: ReadonlyArray<ProjectApprovalGrant>;
  /** Projects put away, newest last (Settings › Family lists them under "Put away"). */
  readonly projectArchives: ReadonlyArray<ProjectArchive>;
  /** Developer projects a grown-up chose to show the children. */
  readonly kidsVisibleProjects: ReadonlyArray<string>;
  /**
   * Whether the first-run welcome was finished ("done"), skipped ("skipped") or never shown
   * (null). A fact about this Mac's SKYCOT data, kept beside the profile file so it survives the
   * profile being turned on, off or re-coded.
   */
  readonly welcome: WelcomeState;
}

/** How the first-run welcome ended on this Mac; null while it never has. */
export type WelcomeState = "done" | "skipped" | null;

export const WELCOME_FILE_NAME = "welcome.json";

const WelcomeFile = Schema.Struct({
  welcome: Schema.NullOr(Schema.Literals(["done", "skipped"])),
});
const decodeWelcomeFile = Schema.decodeUnknownOption(Schema.fromJsonString(WelcomeFile));
const encodeWelcomeFile = Schema.encodeEffect(Schema.fromJsonString(WelcomeFile));
const decodeWelcome = (raw: string): WelcomeState => {
  const decoded = decodeWelcomeFile(raw);
  return decoded._tag === "Some" ? decoded.value.welcome : null;
};

const projectArchivesOf = (
  file: Pick<FamilyFile, "projectArchives"> | null,
): ReadonlyArray<ProjectArchive> => (file?.projectArchives ?? []).slice(-MAX_PROJECT_ARCHIVES);

const kidsVisibleProjectsOf = (
  file: Pick<FamilyFile, "kidsVisibleProjects"> | null,
): ReadonlyArray<string> => (file?.kidsVisibleProjects ?? []).slice(-MAX_KIDS_VISIBLE_PROJECTS);

const projectApprovalGrantsOf = (
  file: Pick<FamilyFile, "projectApprovalGrants"> | null,
  now: number,
): ReadonlyArray<ProjectApprovalGrant> =>
  (file?.projectApprovalGrants ?? [])
    .filter((grant) => grant.expiresAt > now && grant.covers.length > 0)
    .slice(-MAX_PROJECT_APPROVAL_GRANTS);

const pageInternetAsksOf = (
  file: Pick<FamilyFile, "pageInternetAsks"> | null,
): ReadonlyArray<PageInternetAsk> => file?.pageInternetAsks ?? [];

/** What a parent sets for a child; anything left out keeps its value (or the default). */
export interface ChildInput {
  readonly name?: string | null | undefined;
  readonly avatar?: unknown;
  readonly look?: unknown;
  readonly largerText?: unknown;
  readonly voice?: unknown;
  readonly limits?: unknown;
  readonly askEachStep?: unknown;
  readonly readingLevel?: unknown;
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
  /** The scope on the existing request-bound approval; missing means once. */
  readonly scope?: "once" | "project";
}

export interface UnlockToken {
  readonly token: string;
  readonly sessionToken?: string;
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
      /**
       * The first child's other settings (reading level, look, avatar, limits...) chosen before
       * the child existed, written in the same save as the profile. `childName` wins for the name.
       */
      readonly child?: ChildInput | undefined;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** One code attempt; on success records a grant for this session and returns its token. */
    readonly verify: (input: VerifyInput) => Effect.Effect<UnlockToken, FamilyError>;
    readonly renew: (input: {
      readonly sessionId: string;
    }) => Effect.Effect<UnlockToken, FamilyError>;
    readonly approveRequest: (input: {
      readonly sessionId: string;
      readonly requestId: string;
      readonly scope?: "once" | "project";
    }) => Effect.Effect<void, FamilyError>;
    readonly approvalScope: (input: {
      readonly sessionId: string;
      readonly requestId: string;
    }) => Effect.Effect<{
      readonly scope: "once" | "project";
      readonly how: "parent-code" | "grown-up-session";
    }>;
    readonly prepareUpdate: (input: {
      readonly sessionId: string;
    }) => Effect.Effect<UnlockToken, FamilyError>;
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
    /** Records how the first-run welcome ended. Needs no profile; survives every profile change. */
    readonly setWelcome: (state: "done" | "skipped") => Effect.Effect<FamilyStatus, FamilyError>;
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
    /**
     * "Trusted add-ons download by themselves", either way: one code attempt, counted like
     * every other (the parent's switch; a child cannot flip it).
     */
    readonly setTrustedAddOns: (input: {
      readonly code: string;
      readonly on: boolean;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** Whether the profile is on with trusted add-ons on. Cheap, like `isEnabled`. */
    readonly trustedAddOnsOn: Effect.Effect<boolean>;
    /**
     * A grown-up lets one page (an .html file on this Mac) load things from these internet
     * sites: one code attempt, counted like every other. Adds to what the page had.
     */
    readonly allowPageInternet: (input: {
      readonly code: string;
      readonly page: string;
      readonly sites: ReadonlyArray<string>;
      readonly projectApproval?: {
        readonly childId: string;
        readonly projectPath: string;
        readonly grantedBy: string;
      };
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** Creates or reuses a child's pending request for one page and exact site set. */
    readonly askPageInternet: (input: {
      readonly threadId: string;
      readonly childId: string;
      readonly page: string;
      readonly sites: ReadonlyArray<string>;
    }) => Effect.Effect<PageInternetAsk, FamilyError>;
    /** Pending page requests for the grown-up approval list. */
    readonly pendingPageInternetAsks: Effect.Effect<ReadonlyArray<PageInternetAsk>>;
    /** Settles a page request; approval and its page grant are one profile write. */
    readonly settlePageInternetAsk: (input: {
      readonly id: string;
      readonly decision: "allow" | "decline";
    }) => Effect.Effect<PageInternetAsk, FamilyError>;
    /** Takes a page's internet back. No code: it only makes the profile stricter. */
    readonly stopPageInternet: (input: {
      readonly page: string;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** Records a project yes after the caller has verified the grown-up's answer. */
    readonly grantProjectApproval: (input: {
      readonly childId: string;
      readonly projectPath: string;
      readonly covers: ReadonlyArray<ProjectApprovalCover>;
      readonly grantedBy: string;
      readonly how: ProjectApprovalGrant["how"];
    }) => Effect.Effect<ProjectApprovalGrant, FamilyError>;
    /** Takes away a project yes. No code is needed to make Family stricter. */
    readonly stopProjectApproval: (input: {
      readonly id: string;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /**
     * Puts a project away: hidden from the children's lists, nothing deleted. The caller has
     * already checked who may do it. Putting the same project away again keeps one record.
     */
    // nondev-seam: skycot-project-put-away
    readonly putAwayProject: (input: {
      readonly projectId: string;
      readonly childId: string | null;
      readonly by: ProjectArchive["by"];
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /**
     * Brings a put-away project back. With `undoByChild` it is the child's Undo: it works only
     * for that child's own put-away, inside `PROJECT_UNDO_WINDOW_MS`, and answers null otherwise.
     * Without it the caller is a grown-up whose settings "yes" is already checked.
     */
    readonly bringBackProject: (input: {
      readonly projectId: string;
      readonly undoByChild?: string;
    }) => Effect.Effect<FamilyStatus | null, FamilyError>;
    /** "For the kids": shows (or hides again) a developer project in the children's lists. */
    readonly setKidsVisibleProject: (input: {
      readonly projectId: string;
      readonly visible: boolean;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /**
     * The sites a page may use: null while the profile is off (no policy at all, as before),
     * otherwise the allowed sites (empty: offline). Cheap, like `isEnabled`.
     */
    readonly pageInternetSites: (
      page: string,
      project?: { readonly childId: string; readonly projectPath: string },
    ) => Effect.Effect<ReadonlyArray<string> | null>;
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
      sessionId?: string,
    ) => Effect.Effect<boolean>;
    readonly tokenBelongsToSession: (
      token: string | undefined,
      sessionId: string,
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
    /** A grown-up's device registered its own Face ID key (a new one replaces the old). */
    readonly setDeviceKey: (input: {
      readonly deviceId: string;
      readonly key: FamilyDeviceKey;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
    /** The Face ID key said yes: when is kept, for the record. */
    readonly useDeviceKey: (input: {
      readonly deviceId: string;
      readonly keyId: string;
    }) => Effect.Effect<void, FamilyError>;
    readonly removeDeviceKey: (input: {
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
): {
  readonly purpose: FamilyPurpose;
  readonly expiresAt: number;
  readonly sessionId: string;
} | null {
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
    const sessionId = parsed["s"];
    if (
      typeof purpose !== "string" ||
      !(FAMILY_PURPOSES as ReadonlyArray<string>).includes(purpose) ||
      typeof expiresAt !== "number" ||
      typeof sessionId !== "string"
    ) {
      return null;
    }
    return { purpose: purpose as FamilyPurpose, expiresAt, sessionId };
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

function toStatusBase(file: FamilyFile | null, now: number): Omit<FamilyStatus, "welcome"> {
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
      trustedAddOns: false,
      grownUps: [],
      devices: [],
      pageInternet: [],
      projectApprovalGrants: [],
      projectArchives: [],
      kidsVisibleProjects: [],
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
    trustedAddOns: file.trustedAddOns !== false,
    grownUps: file.grownUps ?? [],
    devices: (file.devices ?? []).map(deviceView),
    pageInternet: pageInternetOf(file),
    projectApprovalGrants: projectApprovalGrantsOf(file, now),
    projectArchives: projectArchivesOf(file),
    kidsVisibleProjects: kidsVisibleProjectsOf(file),
  };
}

/** The file's allowed pages, cleaned: a hand-edited entry can never widen a policy. */
export function pageInternetOf(
  file: Pick<FamilyFile, "pageInternet"> | null,
): ReadonlyArray<PageInternetEntry> {
  const entries: Array<PageInternetEntry> = [];
  for (const entry of file?.pageInternet ?? []) {
    const page = cleanPagePath(entry.page);
    const sites = cleanSites(entry.sites);
    if (page !== null && sites.length > 0) entries.push({ page, sites, at: entry.at });
  }
  return entries.slice(-MAX_PAGE_ENTRIES);
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
    input["kind"] === "character" &&
    (AVATAR_CHARACTERS as ReadonlyArray<unknown>).includes(input["id"])
  ) {
    return { kind: "character", id: input["id"] as (typeof AVATAR_CHARACTERS)[number] };
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
    readingLevel: (READING_LEVELS as ReadonlyArray<unknown>).includes(input.readingLevel)
      ? (input.readingLevel as ReadingLevel)
      : (child.readingLevel ?? DEFAULT_READING_LEVEL),
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
      readingLevel: DEFAULT_READING_LEVEL,
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

/** The device's grown-up grant that runs longest (one per device since beta 36). */
const latestGrownUpGrant = (grants: ReadonlyArray<Grant>, sessionId: string) =>
  grants
    .filter((grant) => grant.sessionId === sessionId && grant.purpose === "grownUpSession")
    .reduce<Grant | undefined>(
      (best, grant) => (best === undefined || grant.expiresAt > best.expiresAt ? grant : best),
      undefined,
    );

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
  const welcomePath = path.join(path.dirname(filePath), WELCOME_FILE_NAME);
  let welcomeNow: WelcomeState = null;
  const toStatus = (file: FamilyFile | null, now: number): FamilyStatus => ({
    ...toStatusBase(file, now),
    welcome: welcomeNow,
  });
  // Read each time (a tiny file): the status always carries what is on disk.
  const loadWelcome = Effect.gen(function* () {
    const raw = yield* fs.readFileString(welcomePath).pipe(Effect.orElseSucceed(() => ""));
    welcomeNow = decodeWelcome(raw);
  });

  const loadProfile = Effect.gen(function* () {
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
  const load = loadWelcome.pipe(Effect.andThen(loadProfile));

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
    const file = yield* load;
    const at = yield* now;
    if (file === null) return toStatus(null, at);
    const grants = projectApprovalGrantsOf(file, at);
    const savedGrants = file.projectApprovalGrants ?? [];
    if (grants.length !== savedGrants.length) {
      const next = { ...file, projectApprovalGrants: grants };
      yield* save(next);
      return toStatus(next, at);
    }
    return toStatus(file, at);
  }).pipe(Effect.withSpan("SkycotFamily.status"), lock.withPermits(1));

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
      children: [
        newChild(
          {
            ...input.child,
            ...(input.childName !== null || input.child?.name === undefined
              ? { name: input.childName }
              : {}),
          },
          0,
          createdAt,
        ),
      ],
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
    if (input.purpose === "grownUpSession") {
      return yield* new FamilyError({ reason: "invalid-request" });
    }
    if (input.purpose === "approve" && !input.requestId) {
      return yield* new FamilyError({ reason: "invalid-request" });
    }
    if (input.scope === "project" && (input.purpose !== "approve" || !input.requestId)) {
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
      ...(input.purpose === "approve" && input.scope === "project"
        ? { scope: "project" as const }
        : {}),
      ...(input.purpose === "approve" && input.scope === "project"
        ? { how: "parent-code" as const }
        : {}),
      expiresAt,
    };
    // A second code on the same device replaces its open grants for the same purpose instead of
    // stacking a new pair each time: with two grown-up grants the renew moved one while the
    // client watched the other, so "Stay" looked dead and grown-up mode ended early.
    const opensSession = input.purpose !== "approve" && input.purpose !== "update";
    const grants = [
      ...liveGrants(cleared.grants, at).filter(
        (open) =>
          open.sessionId !== input.sessionId ||
          !(
            (open.purpose === input.purpose && input.purpose !== "approve") ||
            (opensSession && open.purpose === "grownUpSession")
          ),
      ),
      grant,
    ];
    if (opensSession) {
      grants.push({
        sessionId: input.sessionId,
        purpose: "grownUpSession",
        expiresAt: at + GRANT_TTL_MS.grownUpSession,
        startedAt: at,
        renewals: 0,
      });
    }
    yield* save({ ...cleared, grants });
    return {
      token: signToken(cleared.tokenSecret, {
        purpose: input.purpose,
        expiresAt,
        sessionId: input.sessionId,
      }),
      ...(input.purpose !== "approve" && input.purpose !== "update"
        ? {
            sessionToken: signToken(cleared.tokenSecret, {
              purpose: "advanced",
              expiresAt: at + GRANT_TTL_MS.grownUpSession,
              sessionId: input.sessionId,
            }),
          }
        : {}),
      expiresAt,
      purpose: input.purpose,
    } satisfies UnlockToken;
  }, lock.withPermits(1));

  const renew: SkycotFamily["Service"]["renew"] = Effect.fn("SkycotFamily.renew")(function* (
    input,
  ) {
    const file = yield* requireEnabled(yield* load);
    const at = yield* now;
    const live = liveGrants(file.grants, at);
    // Older profile files can still hold more than one grown-up grant for a device: renew the one
    // that runs longest, which is the one the client shows.
    const current = latestGrownUpGrant(live, input.sessionId);
    if (current === undefined || current.expiresAt <= at) {
      return yield* new FamilyError({ reason: "invalid-request" });
    }
    const startedAt = current.startedAt ?? at;
    const cap = startedAt + GROWN_UP_SESSION_MAX_MS;
    if (at >= cap) return yield* new FamilyError({ reason: "invalid-request" });
    const expiresAt = Math.min(at + GRANT_TTL_MS.grownUpSession, cap);
    yield* save({
      ...file,
      grants: live.map((grant) =>
        grant === current
          ? { ...grant, startedAt, renewals: (grant.renewals ?? 0) + 1, expiresAt }
          : grant,
      ),
    });
    const token = signToken(file.tokenSecret, {
      purpose: "advanced",
      expiresAt,
      sessionId: input.sessionId,
    });
    return { token, sessionToken: token, expiresAt, purpose: "advanced" as const };
  }, lock.withPermits(1));

  const approveRequest: SkycotFamily["Service"]["approveRequest"] = Effect.fn(
    "SkycotFamily.approveRequest",
  )(function* (input) {
    const file = yield* requireEnabled(yield* load);
    const at = yield* now;
    if (
      !liveGrants(file.grants, at).some(
        (grant) => grant.sessionId === input.sessionId && grant.purpose === "grownUpSession",
      )
    ) {
      return yield* new FamilyError({ reason: "invalid-request" });
    }
    yield* save({
      ...file,
      grants: [
        ...liveGrants(file.grants, at),
        {
          sessionId: input.sessionId,
          purpose: "approve",
          requestId: input.requestId,
          ...(input.scope === "project" ? { scope: "project" as const } : {}),
          ...(input.scope === "project" ? { how: "grown-up-session" as const } : {}),
          expiresAt: at + GRANT_TTL_MS.approve,
        },
      ],
    });
  }, lock.withPermits(1));

  const approvalScope: SkycotFamily["Service"]["approvalScope"] = (input) =>
    Effect.gen(function* () {
      const file = yield* load;
      const at = yield* now;
      const grant = liveGrants(file?.grants ?? [], at).find(
        (entry) =>
          entry.sessionId === input.sessionId &&
          entry.purpose === "approve" &&
          entry.requestId === input.requestId,
      );
      return {
        scope: grant?.scope === "project" ? ("project" as const) : ("once" as const),
        how: grant?.how ?? "parent-code",
      };
    });

  const prepareUpdate: SkycotFamily["Service"]["prepareUpdate"] = Effect.fn(
    "SkycotFamily.prepareUpdate",
  )(function* (input) {
    const file = yield* requireEnabled(yield* load);
    const at = yield* now;
    const live = liveGrants(file.grants, at);
    const current = latestGrownUpGrant(live, input.sessionId);
    if (
      current === undefined ||
      current.expiresAt <= at ||
      at >= (current.startedAt ?? at) + GROWN_UP_SESSION_MAX_MS
    ) {
      return yield* new FamilyError({ reason: "invalid-request" });
    }
    const sessionExpiresAt = Math.min(
      at + GRANT_TTL_MS.grownUpSession,
      (current.startedAt ?? at) + GROWN_UP_SESSION_MAX_MS,
    );
    const updateExpiresAt = at + GRANT_TTL_MS.update;
    const grants = live
      .filter((grant) => !(grant.sessionId === input.sessionId && grant.purpose === "update"))
      .map((grant) =>
        grant === current
          ? { ...grant, expiresAt: sessionExpiresAt, renewals: (grant.renewals ?? 0) + 1 }
          : grant,
      );
    grants.push({
      sessionId: input.sessionId,
      purpose: "update",
      expiresAt: updateExpiresAt,
    });
    yield* save({ ...file, grants });
    const token = signToken(file.tokenSecret, {
      purpose: "advanced",
      expiresAt: sessionExpiresAt,
      sessionId: input.sessionId,
    });
    return { token, sessionToken: token, expiresAt: updateExpiresAt, purpose: "update" as const };
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

  const setWelcome: SkycotFamily["Service"]["setWelcome"] = Effect.fn("SkycotFamily.setWelcome")(
    function* (state) {
      const file = yield* load;
      yield* Effect.gen(function* () {
        yield* fs.makeDirectory(path.dirname(welcomePath), { recursive: true });
        const temp = `${welcomePath}.${hex(NodeCrypto.randomBytes(6))}.tmp`;
        yield* fs.writeFileString(temp, `${yield* encodeWelcomeFile({ welcome: state })}\n`, {
          mode: 0o600,
        });
        yield* fs.rename(temp, welcomePath);
      }).pipe(Effect.mapError((cause) => new FamilyError({ reason: "storage", cause })));
      welcomeNow = state;
      return toStatus(file, yield* now);
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

  const allowPageInternet: SkycotFamily["Service"]["allowPageInternet"] = Effect.fn(
    "SkycotFamily.allowPageInternet",
  )(function* (input) {
    const asked = cleanPagePath(input.page);
    const sites = cleanSites(input.sites);
    // The page's real place on disk, as SKYCOT's page server sees it: a page that is not there
    // (or is not a file) is no request at all.
    const real =
      asked === null ? null : yield* fs.realPath(asked).pipe(Effect.orElseSucceed(() => null));
    const info = real === null ? null : yield* fs.stat(real).pipe(Effect.orElseSucceed(() => null));
    const page = real === null || info?.type !== "File" ? null : cleanPagePath(real);
    if (page === null || sites.length === 0) {
      return yield* new FamilyError({ reason: "invalid-request" });
    }
    const file = yield* requireEnabled(yield* load);
    const at = yield* now;
    const cleared = yield* attempt(file, input.code, at);
    const pageInternet = withAllowed(pageInternetOf(cleared), page, sites, at);
    const allowedSites = sitesForPage(pageInternet, page);
    const pageInternetAsks = pageInternetAsksOf(cleared).map((ask) =>
      ask.status === "pending" &&
      ask.expiresAt > at &&
      ask.page === page &&
      ask.sites.every((site) => allowedSites.includes(site))
        ? { ...ask, status: "allowed" as const }
        : ask,
    );
    let projectApprovalGrants = projectApprovalGrantsOf(cleared, at);
    if (input.projectApproval !== undefined) {
      const { childId, projectPath, grantedBy } = input.projectApproval;
      const canonicalProjectPath = yield* fs
        .realPath(projectPath)
        .pipe(Effect.orElseSucceed(() => null));
      const pageFromProject = path.relative(projectPath, page);
      if (
        !cleared.children.some((child) => child.id === childId) ||
        projectPath.length === 0 ||
        grantedBy.length === 0 ||
        canonicalProjectPath !== projectPath ||
        pageFromProject.startsWith("..") ||
        path.isAbsolute(pageFromProject)
      )
        return yield* new FamilyError({ reason: "invalid-request" });
      const existing = projectApprovalGrants.find(
        (grant) => grant.childId === childId && grant.projectPath === projectPath,
      );
      const grant: ProjectApprovalGrant = {
        id: existing?.id ?? hex(NodeCrypto.randomBytes(16)),
        childId,
        projectPath,
        covers: [...new Set([...(existing?.covers ?? []), "internetAssets" as const])],
        grantedBy,
        how: "parent-code",
        createdAt: at,
        expiresAt: at + PROJECT_APPROVAL_TTL_MS,
      };
      projectApprovalGrants = [
        ...projectApprovalGrants.filter((entry) => entry.id !== existing?.id),
        grant,
      ].slice(-MAX_PROJECT_APPROVAL_GRANTS);
    }
    const next: FamilyFile = {
      ...cleared,
      pageInternet,
      pageInternetAsks,
      ...(input.projectApproval === undefined ? {} : { projectApprovalGrants }),
    };
    yield* save(next);
    yield* Effect.logInfo("skycot-family.page-internet-allowed", { sites });
    return toStatus(next, at);
  }, lock.withPermits(1));

  const askPageInternet: SkycotFamily["Service"]["askPageInternet"] = Effect.fn(
    "SkycotFamily.askPageInternet",
  )(function* (input) {
    const asked = cleanPagePath(input.page);
    const sites = cleanSites(input.sites);
    const real =
      asked === null ? null : yield* fs.realPath(asked).pipe(Effect.orElseSucceed(() => null));
    const info = real === null ? null : yield* fs.stat(real).pipe(Effect.orElseSucceed(() => null));
    const page = real === null || info?.type !== "File" ? null : cleanPagePath(real);
    if (
      page === null ||
      sites.length === 0 ||
      input.threadId.length === 0 ||
      input.childId.length === 0 ||
      input.threadId.length > 200 ||
      input.childId.length > 100 ||
      input.sites.length > MAX_PAGE_SITES ||
      input.sites.some((site) => typeof site !== "string" || cleanSites([site]).length === 0)
    ) {
      return yield* new FamilyError({ reason: "invalid-request" });
    }
    const file = yield* requireEnabled(yield* load);
    const at = yield* now;
    const asks = pageInternetAsksOf(file).filter(
      (ask) => ask.status === "pending" && ask.expiresAt > at,
    );
    const same = asks.find(
      (ask) =>
        ask.status === "pending" &&
        ask.threadId === input.threadId &&
        ask.childId === input.childId &&
        ask.page === page &&
        JSON.stringify(ask.sites) === JSON.stringify(sites),
    );
    if (same !== undefined) return same;
    const nextAsk: PageInternetAsk = {
      id: `page-internet:${NodeCrypto.randomUUID()}`,
      threadId: input.threadId,
      childId: input.childId,
      page,
      sites,
      createdAt: at,
      expiresAt: at + PAGE_INTERNET_ASK_TTL_MS,
      status: "pending",
    };
    const next: FamilyFile = {
      ...file,
      pageInternetAsks: [
        ...asks.map((ask) =>
          ask.status === "pending" && ask.threadId === input.threadId && ask.page === page
            ? { ...ask, status: "superseded" as const }
            : ask,
        ),
        nextAsk,
      ].slice(-MAX_PAGE_INTERNET_ASKS),
    };
    yield* save(next);
    return nextAsk;
  }, lock.withPermits(1));

  const pendingPageInternetAsks: SkycotFamily["Service"]["pendingPageInternetAsks"] = Effect.gen(
    function* () {
      const file = yield* load;
      return pageInternetAsksOf(file).filter((ask) => ask.status === "pending");
    },
  ).pipe(Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<PageInternetAsk>)));

  const settlePageInternetAsk: SkycotFamily["Service"]["settlePageInternetAsk"] = Effect.fn(
    "SkycotFamily.settlePageInternetAsk",
  )(function* (input) {
    const file = yield* requireEnabled(yield* load);
    const at = yield* now;
    const asks = pageInternetAsksOf(file);
    const ask = asks.find((item) => item.id === input.id);
    if (ask === undefined || ask.status !== "pending") {
      return yield* new FamilyError({ reason: "invalid-request" });
    }
    if (ask.expiresAt <= at) return yield* new FamilyError({ reason: "invalid-request" });
    let pageInternet = pageInternetOf(file);
    if (input.decision === "allow") {
      const real = yield* fs.realPath(ask.page).pipe(Effect.orElseSucceed(() => null));
      const info =
        real === null ? null : yield* fs.stat(real).pipe(Effect.orElseSucceed(() => null));
      const page = real === null || info?.type !== "File" ? null : cleanPagePath(real);
      if (page === null || page !== ask.page)
        return yield* new FamilyError({ reason: "invalid-request" });
      pageInternet = withAllowed(pageInternet, page, ask.sites, at);
    }
    const settled: PageInternetAsk = {
      ...ask,
      status: input.decision === "allow" ? "allowed" : "declined",
    };
    yield* save({
      ...file,
      pageInternet,
      pageInternetAsks: asks.map((item) => (item.id === ask.id ? settled : item)),
    });
    return settled;
  }, lock.withPermits(1));

  const stopPageInternet: SkycotFamily["Service"]["stopPageInternet"] = Effect.fn(
    "SkycotFamily.stopPageInternet",
  )(function* (input) {
    const file = yield* requireEnabled(yield* load);
    const entries = pageInternetOf(file);
    const page = cleanPagePath(input.page);
    if (page === null || !entries.some((entry) => entry.page === page)) {
      return toStatus(file, yield* now);
    }
    const next: FamilyFile = {
      ...file,
      pageInternet: entries.filter((entry) => entry.page !== page),
    };
    yield* save(next);
    yield* Effect.logInfo("skycot-family.page-internet-stopped");
    return toStatus(next, yield* now);
  }, lock.withPermits(1));

  // nondev-seam: skycot-project-approval-page-internet
  const pageInternetSites: SkycotFamily["Service"]["pageInternetSites"] = (page, project) =>
    Effect.gen(function* () {
      const file = yield* load;
      if (file === null || !file.enabled) return null;
      const entries = pageInternetOf(file);
      const direct = sitesForPage(entries, page);
      if (project === undefined) return direct;
      const at = yield* now;
      const grants = projectApprovalGrantsOf(file, at).filter(
        (grant) =>
          grant.childId === project.childId &&
          grant.projectPath === project.projectPath &&
          grant.covers.includes("internetAssets"),
      );
      if (grants.length === 0) return direct;
      const inProject = entries.filter((entry) => {
        const relative = path.relative(project.projectPath, entry.page);
        return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
      });
      return [...new Set([...direct, ...inProject.flatMap((entry) => entry.sites)])].toSorted();
    }).pipe(
      // An unreadable profile keeps the page offline, never open.
      Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<string>)),
    );

  // nondev-seam: skycot-project-approval-grants
  const grantProjectApproval: SkycotFamily["Service"]["grantProjectApproval"] = Effect.fn(
    "SkycotFamily.grantProjectApproval",
  )(function* (input) {
    const file = yield* requireEnabled(yield* load);
    if (
      !file.children.some((child) => child.id === input.childId) ||
      input.projectPath.length === 0 ||
      input.covers.length === 0 ||
      input.covers.some(
        (cover) => !(PROJECT_APPROVAL_COVERS as ReadonlyArray<string>).includes(cover),
      )
    )
      return yield* new FamilyError({ reason: "invalid-request" });
    const at = yield* now;
    const grant: ProjectApprovalGrant = {
      id: hex(NodeCrypto.randomBytes(16)),
      childId: input.childId,
      projectPath: input.projectPath,
      covers: [...new Set(input.covers)],
      grantedBy: input.grantedBy,
      how: input.how,
      createdAt: at,
      expiresAt: at + PROJECT_APPROVAL_TTL_MS,
    };
    const existing = projectApprovalGrantsOf(file, at);
    const sameProject = existing.find(
      (entry) => entry.childId === grant.childId && entry.projectPath === grant.projectPath,
    );
    const saved =
      sameProject === undefined
        ? grant
        : {
            ...grant,
            id: sameProject.id,
            covers: [...new Set([...sameProject.covers, ...grant.covers])],
          };
    const grants = [...existing.filter((entry) => entry.id !== sameProject?.id), saved].slice(
      -MAX_PROJECT_APPROVAL_GRANTS,
    );
    yield* save({ ...file, projectApprovalGrants: grants });
    return saved;
  }, lock.withPermits(1));

  const stopProjectApproval: SkycotFamily["Service"]["stopProjectApproval"] = Effect.fn(
    "SkycotFamily.stopProjectApproval",
  )(function* ({ id }) {
    const file = yield* requireEnabled(yield* load);
    const at = yield* now;
    const grants = projectApprovalGrantsOf(file, at).filter((grant) => grant.id !== id);
    const next = { ...file, projectApprovalGrants: grants };
    yield* save(next);
    return toStatus(next, at);
  }, lock.withPermits(1));

  // nondev-seam: skycot-project-put-away
  const putAwayProject: SkycotFamily["Service"]["putAwayProject"] = Effect.fn(
    "SkycotFamily.putAwayProject",
  )(function* ({ projectId, childId, by }) {
    const file = yield* requireEnabled(yield* load);
    if (projectId.length === 0 || projectId.length > 200)
      return yield* new FamilyError({ reason: "invalid-request" });
    const at = yield* now;
    const archives = [
      ...projectArchivesOf(file).filter((entry) => entry.projectId !== projectId),
      { projectId, childId, archivedAt: at, by },
    ].slice(-MAX_PROJECT_ARCHIVES);
    const next = { ...file, projectArchives: archives };
    yield* save(next);
    return toStatus(next, at);
  }, lock.withPermits(1));

  const bringBackProject: SkycotFamily["Service"]["bringBackProject"] = Effect.fn(
    "SkycotFamily.bringBackProject",
  )(function* ({ projectId, undoByChild }) {
    const file = yield* requireEnabled(yield* load);
    const at = yield* now;
    const archives = projectArchivesOf(file);
    const record = archives.find((entry) => entry.projectId === projectId);
    if (undoByChild !== undefined) {
      // The Undo is the child's own, for their own put-away, and short: a child can never
      // reach further than that (anything else needs a grown-up's "yes").
      if (
        record === undefined ||
        record.by !== "child" ||
        record.childId !== undoByChild ||
        at - record.archivedAt > PROJECT_UNDO_WINDOW_MS
      )
        return null;
    }
    const next = { ...file, projectArchives: archives.filter((e) => e.projectId !== projectId) };
    yield* save(next);
    return toStatus(next, at);
  }, lock.withPermits(1));

  const setKidsVisibleProject: SkycotFamily["Service"]["setKidsVisibleProject"] = Effect.fn(
    "SkycotFamily.setKidsVisibleProject",
  )(function* ({ projectId, visible }) {
    const file = yield* requireEnabled(yield* load);
    if (projectId.length === 0 || projectId.length > 200)
      return yield* new FamilyError({ reason: "invalid-request" });
    const others = kidsVisibleProjectsOf(file).filter((id) => id !== projectId);
    const next = {
      ...file,
      kidsVisibleProjects: (visible ? [...others, projectId] : others).slice(
        -MAX_KIDS_VISIBLE_PROJECTS,
      ),
    };
    yield* save(next);
    return toStatus(next, yield* now);
  }, lock.withPermits(1));

  const assistantAllowed: SkycotFamily["Service"]["assistantAllowed"] = (driver) =>
    load.pipe(
      Effect.map(
        (file) => file !== null && file.enabled && allowedAssistantsOf(file).includes(driver),
      ),
    );

  const setTrustedAddOns: SkycotFamily["Service"]["setTrustedAddOns"] = Effect.fn(
    "SkycotFamily.setTrustedAddOns",
  )(function* (input) {
    const file = yield* requireEnabled(yield* load);
    const at = yield* now;
    const cleared = yield* attempt(file, input.code, at);
    const next: FamilyFile = { ...cleared, trustedAddOns: input.on };
    yield* save(next);
    yield* Effect.logInfo("skycot-family.trusted-add-ons", { on: input.on });
    return toStatus(next, at);
  }, lock.withPermits(1));

  const trustedAddOnsOn: SkycotFamily["Service"]["trustedAddOnsOn"] = load.pipe(
    Effect.map((file) => file !== null && file.enabled && file.trustedAddOns !== false),
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
    if (
      input.purpose !== "approve" &&
      input.purpose !== "update" &&
      forSession.some((grant) => grant.purpose === "grownUpSession")
    ) {
      return true;
    }
    if (input.purpose !== "approve" && forSession.some((grant) => grant.purpose === "advanced"))
      return true;
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
      // One entry per purpose, the one that runs longest: the client keeps the last entry it
      // sees per purpose, so duplicates in an older file must not hide the live one.
      const longest = new Map<FamilyPurpose, number>();
      for (const grant of liveGrants(file.grants, at)) {
        if (grant.sessionId !== input.sessionId || grant.purpose === "approve") continue;
        const remainingMs = grant.expiresAt - at;
        if ((longest.get(grant.purpose) ?? 0) < remainingMs)
          longest.set(grant.purpose, remainingMs);
      }
      return [...longest].map(([purpose, remainingMs]) => ({ purpose, remainingMs }));
    },
  );

  const tokenAllows: SkycotFamily["Service"]["tokenAllows"] = Effect.fn("SkycotFamily.tokenAllows")(
    function* (token, purpose, sessionId) {
      const file = yield* load;
      if (file === null || !file.enabled) return true;
      if (token === undefined || token.length === 0) return false;
      const read = readToken(file.tokenSecret, token);
      if (read === null) return false;
      return (
        read.expiresAt > (yield* now) &&
        (sessionId === undefined || read.sessionId === sessionId) &&
        (read.purpose === purpose || read.purpose === "advanced")
      );
    },
  );

  const tokenBelongsToSession: SkycotFamily["Service"]["tokenBelongsToSession"] = Effect.fn(
    "SkycotFamily.tokenBelongsToSession",
  )(function* (token, sessionId) {
    const file = yield* load;
    if (file === null || !file.enabled) return true;
    if (!token) return false;
    const read = readToken(file.tokenSecret, token);
    return read !== null && read.sessionId === sessionId && read.expiresAt > (yield* now);
  });

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

  const setDeviceKey: SkycotFamily["Service"]["setDeviceKey"] = (input) =>
    updateDevice("setDeviceKey", input.deviceId, (current) =>
      // Never a child's device: a Face ID yes is a grown-up's, on a grown-up's device.
      current.kind === "grown-up" ? { ...current, deviceKey: input.key } : null,
    );

  const useDeviceKey: SkycotFamily["Service"]["useDeviceKey"] = (input) =>
    updateDevice("useDeviceKey", input.deviceId, (current, _file, at) =>
      current.deviceKey !== undefined && current.deviceKey.id === input.keyId
        ? {
            ...current,
            deviceKey: {
              ...current.deviceKey,
              lastUsedAt: DateTime.formatIso(DateTime.makeUnsafe(at)),
            },
          }
        : null,
    ).pipe(Effect.asVoid);

  const removeDeviceKey: SkycotFamily["Service"]["removeDeviceKey"] = (input) =>
    updateDevice("removeDeviceKey", input.deviceId, (current) => {
      const { deviceKey: _gone, ...rest } = current;
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
    setDeviceKey,
    useDeviceKey,
    removeDeviceKey,
    status,
    openGrants,
    isEnabled,
    enable,
    verify,
    renew,
    approveRequest,
    approvalScope,
    prepareUpdate,
    disable,
    changeCode,
    rename,
    addChild,
    updateChild,
    removeChild,
    setTimeZone,
    setWelcome,
    checkCode,
    allowAssistant,
    stopAllowingAssistant,
    assistantAllowed,
    setTrustedAddOns,
    trustedAddOnsOn,
    allowPageInternet,
    askPageInternet,
    pendingPageInternetAsks,
    settlePageInternetAsk,
    stopPageInternet,
    pageInternetSites,
    grantProjectApproval,
    stopProjectApproval,
    putAwayProject,
    bringBackProject,
    setKidsVisibleProject,
    lock: lockSession,
    allows,
    tokenAllows,
    tokenBelongsToSession,
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
