// The Family profile, pure part. The engine keeps the profile (the hashed parent code, the
// wrong-try counter, the "a grown-up said yes" grants) and enforces it; this client shows its
// state and asks for the code. What is here: the status the engine reports, the view the UI
// renders (with a small localStorage cache for first paint only), which actions a code
// guards, and the code-format helpers. The older browser-only record (`FamilyProfile`,
// `skycot:family`) stays readable so a profile set up before the move can be carried over.
// Nothing here touches the DOM or the network; store.ts and api.ts do.
import { parseChildren, type FamilyChild } from "./children";
import { parseSessionLimits, type SessionLimits } from "../family-limits/limits";

export type FamilyAction =
  | "publish"
  | "advancedMode"
  | "disableFamily"
  | "changeCode"
  | "createAutomation"
  | "changeAutonomy"
  | "changeTheme"
  | "rerunOnboarding"
  | "openFolder"
  | "approve"
  | "aiSettings"
  | "renameChild"
  | "saveSecret"
  | "voiceSettings"
  | "manageChildren"
  | "switchChild"
  | "seeRecap"
  | "restartToUpdate"
  /** Files: Show everything (hidden and secret files, add-ons) and Show in Finder. */
  | "seeAllFiles";

/** The browser-only record from before the engine kept the profile. */
export const FAMILY_KEY = "skycot:family";
export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 5 * 60_000;
export const CODE_MIN = 4;
export const CODE_MAX = 6;

/** Picking a look stays open: kids may choose themes. Everything else waits for the code. */
export const LOCKED_ACTIONS: ReadonlySet<FamilyAction> = new Set<FamilyAction>([
  "publish",
  "advancedMode",
  "disableFamily",
  "changeCode",
  "createAutomation",
  "changeAutonomy",
  "rerunOnboarding",
  "openFolder",
  "approve",
  "aiSettings",
  "renameChild",
  "saveSecret",
  "voiceSettings",
  "manageChildren",
  "switchChild",
  "seeRecap",
  "restartToUpdate",
  "seeAllFiles",
]);

/** What a grown-up's "yes" opens on the engine (SkycotFamily.FAMILY_PURPOSES). */
export type FamilyPurpose =
  | "approve"
  | "publish"
  | "automation"
  | "openFolder"
  | "settings"
  | "advanced"
  | "recap"
  | "update"
  | "files";

/**
 * The engine grant an action asks for. Turning the profile off and changing the code are not
 * grants: the code goes with that one request.
 */
export function purposeFor(action: FamilyAction): FamilyPurpose | null {
  switch (action) {
    case "publish":
      return "publish";
    case "createAutomation":
      return "automation";
    case "advancedMode":
      return "advanced";
    case "openFolder":
      return "openFolder";
    case "approve":
      return "approve";
    case "seeRecap":
      return "recap";
    case "restartToUpdate":
      return "update";
    case "seeAllFiles":
      return "files";
    case "aiSettings":
    case "rerunOnboarding":
    case "changeAutonomy":
    case "renameChild":
    case "saveSecret":
    case "voiceSettings":
    case "manageChildren":
    case "switchChild":
      return "settings";
    case "disableFamily":
    case "changeCode":
    case "changeTheme":
      return null;
  }
}

/** A grown-up's "yes" still open on this device. */
export interface OpenGrant {
  readonly purpose: FamilyPurpose;
  readonly remainingMs: number;
}

/** `GET /api/skycot/family`, as the engine sends it. Never the hash. */
export interface ServerFamilyStatus {
  readonly enabled: boolean;
  readonly childName: string | null;
  readonly createdAt: string | null;
  readonly attemptsLeft: number;
  readonly lockedForMs: number;
  /** Only the status read carries these; other answers leave them out. */
  readonly grants?: ReadonlyArray<OpenGrant>;
  readonly children: ReadonlyArray<FamilyChild>;
  /** The zone bedtimes are read in. */
  readonly timeZone: string | null;
  /** Who is using SKYCOT on this device; only the status read carries it. */
  readonly session?: SessionLimits;
}

const PURPOSES: ReadonlySet<string> = new Set<FamilyPurpose>([
  "approve",
  "publish",
  "automation",
  "openFolder",
  "settings",
  "advanced",
  "recap",
  "files",
]);

function parseGrants(value: unknown): ReadonlyArray<OpenGrant> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const purpose = record["purpose"];
    const remainingMs = record["remainingMs"];
    return typeof purpose === "string" &&
      PURPOSES.has(purpose) &&
      typeof remainingMs === "number" &&
      remainingMs > 0
      ? [{ purpose: purpose as FamilyPurpose, remainingMs }]
      : [];
  });
}

export function parseServerStatus(body: unknown): ServerFamilyStatus | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record["enabled"] !== "boolean") return null;
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : null);
  const number = (key: string, fallback: number) =>
    typeof record[key] === "number" && Number.isFinite(record[key])
      ? (record[key] as number)
      : fallback;
  return {
    enabled: record["enabled"],
    childName: text("childName"),
    createdAt: text("createdAt"),
    attemptsLeft: Math.max(0, Math.floor(number("attemptsLeft", MAX_ATTEMPTS))),
    lockedForMs: Math.max(0, number("lockedForMs", 0)),
    ...(parseGrants(record["grants"]) === undefined
      ? {}
      : { grants: parseGrants(record["grants"])! }),
    children: parseChildren(record["children"]),
    timeZone: text("timeZone"),
    ...(parseSessionLimits(record["session"]) === null
      ? {}
      : { session: parseSessionLimits(record["session"])! }),
  };
}

export type FamilyFailure =
  | "not-enabled"
  | "already-enabled"
  | "invalid-code"
  | "wrong-code"
  | "locked"
  | "invalid-request"
  | "storage"
  | "unauthenticated"
  | "forbidden"
  | "asleep"
  | "unreachable";

export type FamilyResult<A> =
  | { readonly ok: true; readonly value: A }
  | {
      readonly ok: false;
      readonly reason: FamilyFailure;
      readonly message: string;
      readonly attemptsLeft?: number;
      readonly remainingMs?: number;
    };

export const ENGINE_UNREACHABLE =
  "SKYCOT's engine isn't answering, so the Family profile can't be checked. Check the Mac is awake and try again.";

/**
 * Reads one answer: a value on 2xx, the engine's own sentence otherwise. A wrong or locked
 * code comes back as 200 with `error` (an expected answer, not a failed request).
 */
export function readFamilyAnswer<A>(
  status: number,
  body: unknown,
  decode: (body: unknown) => A | null,
): FamilyResult<A> {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (status >= 200 && status < 300 && typeof record["error"] !== "string") {
    const value = decode(body);
    return value === null
      ? {
          ok: false,
          reason: "invalid-request",
          message: "The engine sent an answer this app doesn't understand.",
        }
      : { ok: true, value };
  }
  const reason = (
    typeof record["error"] === "string" ? record["error"] : "storage"
  ) as FamilyFailure;
  const message =
    typeof record["message"] === "string" && record["message"].length > 0
      ? record["message"]
      : ENGINE_UNREACHABLE;
  return {
    ok: false,
    reason,
    message,
    ...(typeof record["attemptsLeft"] === "number" ? { attemptsLeft: record["attemptsLeft"] } : {}),
    ...(typeof record["remainingMs"] === "number" ? { remainingMs: record["remainingMs"] } : {}),
  };
}

/** What the UI renders. */
export interface FamilyView {
  readonly enabled: boolean;
  /** The name of the child using SKYCOT on this device (the greeting's). */
  readonly childName: string | null;
  readonly children: ReadonlyArray<FamilyChild>;
  /** The child using SKYCOT on this device; null while one has to be chosen. */
  readonly currentChildId: string | null;
  /** More than one child and none chosen on this device yet. */
  readonly needsChoice: boolean;
  readonly timeZone: string | null;
  readonly createdAt: string | null;
  readonly attemptsLeft: number;
  /** Epoch ms (this browser's clock) until code prompts open again; null when not locked. */
  readonly lockedUntil: number | null;
  /** What a grown-up has opened on this device, until when (this browser's clock). */
  readonly openUntil: Partial<Readonly<Record<FamilyPurpose, number>>>;
  /** "engine" once the engine has answered; "cache" while only the first-paint cache is known. */
  readonly source: "engine" | "cache";
  /** A profile set up before the engine kept it, still only in this browser. */
  readonly legacy: boolean;
}

export const EMPTY_VIEW: FamilyView = {
  enabled: false,
  childName: null,
  children: [],
  currentChildId: null,
  needsChoice: false,
  timeZone: null,
  createdAt: null,
  attemptsLeft: MAX_ATTEMPTS,
  lockedUntil: null,
  openUntil: {},
  source: "cache",
  legacy: false,
};

/**
 * Which child this device is using: the engine's answer when the status carries one, else the
 * one remembered from before (a status from a change carries none), else the only child.
 */
export function currentChildOf(
  children: ReadonlyArray<FamilyChild>,
  session: Pick<SessionLimits, "childId" | "needsChoice"> | undefined,
  previous: string | null,
): { readonly currentChildId: string | null; readonly needsChoice: boolean } {
  const known = (id: string | null) =>
    id !== null && children.some((child) => child.id === id) ? id : null;
  if (session !== undefined) {
    const id = known(session.childId);
    return { currentChildId: id, needsChoice: id === null && children.length > 1 };
  }
  const kept = known(previous) ?? (children.length === 1 ? children[0]!.id : null);
  return { currentChildId: kept, needsChoice: kept === null && children.length > 1 };
}

export function currentChild(
  view: Pick<FamilyView, "children" | "currentChildId">,
): FamilyChild | null {
  return view.children.find((child) => child.id === view.currentChildId) ?? null;
}

export function viewFromStatus(
  status: ServerFamilyStatus,
  now: number,
  legacy: boolean,
  previous: Pick<FamilyView, "openUntil" | "currentChildId"> = EMPTY_VIEW,
): FamilyView {
  const choice = currentChildOf(status.children, status.session, previous.currentChildId);
  const child = status.children.find((candidate) => candidate.id === choice.currentChildId);
  return {
    ...choice,
    children: status.children,
    timeZone: status.timeZone,
    // Answers other than the status read carry no grants: keep what was known.
    openUntil:
      status.grants === undefined
        ? previous.openUntil
        : Object.fromEntries(
            status.grants.map((grant) => [grant.purpose, now + grant.remainingMs]),
          ),
    enabled: status.enabled,
    // An older engine sends one name and no children.
    childName: status.children.length === 0 ? status.childName : (child?.name ?? null),
    createdAt: status.createdAt,
    attemptsLeft: status.attemptsLeft,
    lockedUntil: status.lockedForMs > 0 ? now + status.lockedForMs : null,
    source: "engine",
    // Once the engine has a profile, the browser copy is history.
    legacy: legacy && !status.enabled,
  };
}

export const FAMILY_CACHE_KEY = "skycot:family-cache";

/** First paint only: the engine's last answer, without counters. Never trusted for a decision. */
export function parseCachedView(raw: string | null, legacy: boolean): FamilyView {
  const base = { ...EMPTY_VIEW, legacy };
  if (raw === null) return base;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return base;
    const record = parsed as Record<string, unknown>;
    const children = parseChildren(record["children"]);
    const currentChildId =
      typeof record["currentChildId"] === "string" &&
      children.some((child) => child.id === record["currentChildId"])
        ? record["currentChildId"]
        : null;
    return {
      ...base,
      enabled: record["enabled"] === true,
      childName: typeof record["childName"] === "string" ? record["childName"] : null,
      createdAt: typeof record["createdAt"] === "string" ? record["createdAt"] : null,
      children,
      currentChildId,
      timeZone: typeof record["timeZone"] === "string" ? record["timeZone"] : null,
    };
  } catch {
    return base;
  }
}

export function serializeCachedView(view: FamilyView): string {
  return JSON.stringify({
    enabled: view.enabled,
    childName: view.childName,
    createdAt: view.createdAt,
    children: view.children,
    currentChildId: view.currentChildId,
    timeZone: view.timeZone,
  });
}

/**
 * On for the UI: the engine says so, or a browser-only profile from before the move is still
 * waiting to be carried over (its locks stay in place until it is; the first code prompt
 * moves it).
 */
export function familyOn(view: Pick<FamilyView, "enabled" | "legacy">): boolean {
  return view.enabled || view.legacy;
}

export function isFamilyLocked(
  view: Pick<FamilyView, "enabled" | "legacy">,
  action: FamilyAction,
): boolean {
  return familyOn(view) && LOCKED_ACTIONS.has(action);
}

export function viewLockRemainingMs(view: Pick<FamilyView, "lockedUntil">, now: number): number {
  return view.lockedUntil === null ? 0 : Math.max(0, view.lockedUntil - now);
}

const OPEN_LABELS: ReadonlyArray<readonly [FamilyPurpose, string]> = [
  ["advanced", "Advanced mode"],
  ["settings", "Family and AI settings"],
  ["publish", "publishing"],
  ["automation", "automations"],
  ["openFolder", "other folders"],
  ["files", "all of a project's files"],
];

/**
 * "Open on this device: Advanced mode for 14 more minutes." or null when nothing is open
 * (QA FK-16: the pane looked the same locked and unlocked). Advanced mode covers the rest.
 */
export function openGrantsSentence(
  view: Pick<FamilyView, "openUntil">,
  now: number,
): string | null {
  const minutes = (until: number | undefined) =>
    until === undefined || until <= now ? 0 : Math.ceil((until - now) / 60_000);
  const advanced = minutes(view.openUntil.advanced);
  const open =
    advanced > 0
      ? [[OPEN_LABELS[0]![1], advanced] as const]
      : OPEN_LABELS.slice(1)
          .map(([purpose, label]) => [label, minutes(view.openUntil[purpose])] as const)
          .filter(([, left]) => left > 0);
  if (open.length === 0) return null;
  const parts = open.map(
    ([label, left]) => `${label} for ${left === 1 ? "1 more minute" : `${left} more minutes`}`,
  );
  const joined =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Open on this device: ${joined}.`;
}

export interface FamilyProfile {
  readonly enabled: boolean;
  readonly childName: string | null;
  /** Hex SHA-256 of `${salt}:${code}`; null until a code is set. */
  readonly codeHash: string | null;
  readonly salt: string | null;
  readonly createdAt: string | null;
  readonly failedAttempts: number;
  /** Epoch milliseconds until which every try is refused; null when not locked. */
  readonly lockedUntil: number | null;
}

export const EMPTY_PROFILE: FamilyProfile = {
  enabled: false,
  childName: null,
  codeHash: null,
  salt: null,
  createdAt: null,
  failedAttempts: 0,
  lockedUntil: null,
};

export function isValidCode(code: string): boolean {
  return new RegExp(`^\\d{${CODE_MIN},${CODE_MAX}}$`).test(code);
}

/** Keeps only digits and the first six of them, for an input that formats as it goes. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, CODE_MAX);
}

export type CodeStrength = "weak" | "ok" | "strong";

/**
 * A nudge, not a gate: a repeated or stepped code ("1111", "1234") is weak,
 * six mixed digits is strong, anything else is fine. Only valid codes are rated.
 */
export function codeStrength(code: string): CodeStrength | null {
  if (!isValidCode(code)) return null;
  const digits = [...code].map(Number);
  const allSame = digits.every((digit) => digit === digits[0]);
  const step = digits[1]! - digits[0]!;
  const stepped =
    (step === 1 || step === -1) &&
    digits.every((digit, index) => index === 0 || digit - (digits[index - 1] ?? 0) === step);
  if (allSame || stepped) return "weak";
  const distinct = new Set(digits).size;
  return code.length === CODE_MAX && distinct >= 4 ? "strong" : "ok";
}

export function strengthHint(strength: CodeStrength | null, length: number): string {
  if (strength === null) {
    return length === 0
      ? `${CODE_MIN} to ${CODE_MAX} digits.`
      : length < CODE_MIN
        ? `${CODE_MIN - length} more ${CODE_MIN - length === 1 ? "digit" : "digits"} needed.`
        : "Digits only.";
  }
  switch (strength) {
    case "weak":
      return "Easy to guess — a repeated or counting pattern. Any digits still work.";
    case "ok":
      return "Fine. Six digits would be harder to guess.";
    case "strong":
      return "Hard to guess.";
  }
}

type SubtleLike = {
  readonly digest: (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer>;
};

function subtle(): SubtleLike | null {
  const crypto = (globalThis as { crypto?: { subtle?: SubtleLike } }).crypto;
  return crypto?.subtle ?? null;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Hex SHA-256 of `${salt}:${code}` via WebCrypto. Where WebCrypto is missing
 * (an old test runtime), a 64-bit FNV-1a fallback keeps the flow working; it
 * is marked so a real hash never compares equal to a fallback one.
 */
export async function hashCode(code: string, salt: string): Promise<string> {
  const input = new TextEncoder().encode(`${salt}:${code}`);
  const api = subtle();
  if (api) {
    return toHex(new Uint8Array(await api.digest("SHA-256", input)));
  }
  let hash = 0xcbf29ce484222325n;
  for (const byte of input) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `fnv:${hash.toString(16).padStart(16, "0")}`;
}

export function newSalt(): string {
  const bytes = new Uint8Array(16);
  const crypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => void } })
    .crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (Math.random() * 256) | 0;
  return toHex(bytes);
}

export function parseProfile(raw: string | null): FamilyProfile {
  if (raw === null) return EMPTY_PROFILE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY_PROFILE;
    const record = parsed as Record<string, unknown>;
    const string = (key: string) =>
      typeof record[key] === "string" ? (record[key] as string) : null;
    const codeHash = string("codeHash");
    const salt = string("salt");
    // A profile that claims to be on without a code could never be turned off; treat it as off.
    const enabled = record["enabled"] === true && codeHash !== null && salt !== null;
    const lockedUntil = typeof record["lockedUntil"] === "number" ? record["lockedUntil"] : null;
    const failedAttempts =
      typeof record["failedAttempts"] === "number" && record["failedAttempts"] >= 0
        ? Math.floor(record["failedAttempts"])
        : 0;
    return {
      enabled,
      childName: string("childName")?.trim() || null,
      codeHash,
      salt,
      createdAt: string("createdAt"),
      failedAttempts,
      lockedUntil,
    };
  } catch {
    return EMPTY_PROFILE;
  }
}

export function serializeProfile(profile: FamilyProfile): string {
  return JSON.stringify(profile);
}

export async function createProfile({
  childName,
  code,
  now,
}: {
  readonly childName: string | null;
  readonly code: string;
  readonly now: number;
}): Promise<FamilyProfile> {
  if (!isValidCode(code)) throw new Error("A parent code is 4 to 6 digits.");
  const salt = newSalt();
  return {
    enabled: true,
    childName: childName?.trim() || null,
    codeHash: await hashCode(code, salt),
    salt,
    createdAt: new Date(now).toISOString(),
    failedAttempts: 0,
    lockedUntil: null,
  };
}

/** Same child, new code, counters reset: the parent has just proved they know the old one. */
export async function withNewCode(profile: FamilyProfile, code: string): Promise<FamilyProfile> {
  if (!isValidCode(code)) throw new Error("A parent code is 4 to 6 digits.");
  const salt = newSalt();
  return {
    ...profile,
    codeHash: await hashCode(code, salt),
    salt,
    failedAttempts: 0,
    lockedUntil: null,
  };
}

export function withChildName(profile: FamilyProfile, childName: string | null): FamilyProfile {
  return { ...profile, childName: childName?.trim() || null };
}

export function lockoutRemainingMs(profile: FamilyProfile, now: number): number {
  return profile.lockedUntil === null ? 0 : Math.max(0, profile.lockedUntil - now);
}

export function attemptsLeft(profile: FamilyProfile): number {
  return Math.max(0, MAX_ATTEMPTS - profile.failedAttempts);
}

export type VerifyOutcome =
  | { readonly ok: true; readonly profile: FamilyProfile }
  | {
      readonly ok: false;
      readonly kind: "wrong";
      readonly attemptsLeft: number;
      readonly profile: FamilyProfile;
    }
  | {
      readonly ok: false;
      readonly kind: "locked";
      readonly remainingMs: number;
      readonly profile: FamilyProfile;
    };

/**
 * Checks `code` against the profile and returns the profile to store next:
 * counters cleared on success, one more failure otherwise, and after the fifth
 * failure a five-minute wait during which nothing is even compared.
 */
export async function verifyCode(
  profile: FamilyProfile,
  code: string,
  now: number,
): Promise<VerifyOutcome> {
  const remaining = lockoutRemainingMs(profile, now);
  if (remaining > 0) return { ok: false, kind: "locked", remainingMs: remaining, profile };
  // A lockout that has run out starts the count again.
  const base =
    profile.lockedUntil !== null ? { ...profile, failedAttempts: 0, lockedUntil: null } : profile;
  if (base.codeHash === null || base.salt === null) {
    return { ok: true, profile: base };
  }
  const matches = isValidCode(code) && (await hashCode(code, base.salt)) === base.codeHash;
  if (matches) return { ok: true, profile: { ...base, failedAttempts: 0, lockedUntil: null } };
  const failedAttempts = base.failedAttempts + 1;
  if (failedAttempts >= MAX_ATTEMPTS) {
    const locked = { ...base, failedAttempts, lockedUntil: now + LOCKOUT_MS };
    return { ok: false, kind: "locked", remainingMs: LOCKOUT_MS, profile: locked };
  }
  const next = { ...base, failedAttempts };
  return { ok: false, kind: "wrong", attemptsLeft: attemptsLeft(next), profile: next };
}

/** "Try again in 4 minutes." — rounded up so the sentence is never already false. */
export function lockoutSentence(remainingMs: number): string {
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes <= 1) return "Too many tries. Try again in a minute.";
  return `Too many tries. Try again in ${minutes} minutes.`;
}

export function wrongCodeSentence(left: number): string {
  if (left <= 0) return lockoutSentence(LOCKOUT_MS);
  return left === 1
    ? "That's not the parent code. One more try before a five-minute wait."
    : `That's not the parent code. ${left} tries left.`;
}

/** The set-up form (onboarding and Settings share it): child's name, the code typed twice. */
export interface FamilySetupDraft {
  readonly childName: string;
  readonly code: string;
  readonly confirm: string;
}

export const EMPTY_SETUP_DRAFT: FamilySetupDraft = { childName: "", code: "", confirm: "" };

/** Why the draft cannot be saved yet, or null when it can. Only said once the person has typed enough to be told. */
export function setupProblem(draft: FamilySetupDraft): string | null {
  if (!isValidCode(draft.code)) return `The parent code needs ${CODE_MIN} to ${CODE_MAX} digits.`;
  if (draft.confirm.length === 0) return "Type the code a second time.";
  if (draft.confirm !== draft.code) return "The two codes don't match yet.";
  return null;
}

export function setupReady(draft: FamilySetupDraft): boolean {
  return setupProblem(draft) === null;
}
