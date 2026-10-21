// The Family profile, pure part: the stored record, the parent code (hashed,
// never kept in the clear), the five-tries-then-wait rule, and which actions
// the profile locks. Nothing here touches the DOM or storage; store.ts does
// the reading and writing so this file is testable in Node.
//
// Honesty: this is a guardrail for a kid who is not trying to break it. The
// hash and lockout live in this browser's localStorage, so a determined
// teenager with the developer tools can clear it. The copy says so.

export type FamilyAction =
  | "publish"
  | "advancedMode"
  | "disableFamily"
  | "changeCode"
  | "createAutomation"
  | "changeAutonomy"
  | "changeTheme"
  | "rerunOnboarding";

/** Picking a look stays open: kids may choose themes. Everything else waits for the code. */
export const LOCKED_ACTIONS: ReadonlySet<FamilyAction> = new Set<FamilyAction>([
  "publish",
  "advancedMode",
  "disableFamily",
  "changeCode",
  "createAutomation",
  "changeAutonomy",
  "rerunOnboarding",
]);

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

export const FAMILY_KEY = "skycot:family";
export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 5 * 60_000;
export const CODE_MIN = 4;
export const CODE_MAX = 6;

export const EMPTY_PROFILE: FamilyProfile = {
  enabled: false,
  childName: null,
  codeHash: null,
  salt: null,
  createdAt: null,
  failedAttempts: 0,
  lockedUntil: null,
};

export function isFamilyLocked(profile: FamilyProfile, action: FamilyAction): boolean {
  return profile.enabled && profile.codeHash !== null && LOCKED_ACTIONS.has(action);
}

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
