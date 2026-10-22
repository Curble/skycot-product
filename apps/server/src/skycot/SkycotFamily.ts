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

import * as ServerConfig from "../config.ts";

export const FAMILY_FILE_NAME = "skycot-family.json";
export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 5 * 60_000;
export const CODE_PATTERN = /^\d{4,6}$/;
export const CHILD_NAME_MAX = 40;

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
] as const;
export type FamilyPurpose = (typeof FAMILY_PURPOSES)[number];

export const GRANT_TTL_MS: Readonly<Record<FamilyPurpose, number>> = {
  approve: 5 * 60_000,
  publish: 5 * 60_000,
  automation: 5 * 60_000,
  openFolder: 5 * 60_000,
  settings: 10 * 60_000,
  advanced: 15 * 60_000,
};

export const UNLOCK_COOKIE_NAME = "skycot_family_unlock";

const Grant = Schema.Struct({
  sessionId: Schema.String,
  purpose: Schema.Literals(FAMILY_PURPOSES),
  requestId: Schema.optionalKey(Schema.String),
  expiresAt: Schema.Number,
});
type Grant = typeof Grant.Type;

const FamilyFile = Schema.Struct({
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
type FamilyFile = typeof FamilyFile.Type;

const decodeFamilyFile = Schema.decodeUnknownOption(Schema.fromJsonString(FamilyFile));
const encodeFamilyFile = Schema.encodeEffect(Schema.fromJsonString(FamilyFile));

/** What any signed-in client may read. Never the hash, salt or secret. */
export interface FamilyStatus {
  readonly enabled: boolean;
  readonly childName: string | null;
  readonly createdAt: string | null;
  readonly attemptsLeft: number;
  /** Milliseconds until code prompts open again; 0 when not locked. */
  readonly lockedForMs: number;
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

/**
 * MCP capabilities a thread's agent keeps while the Family profile is on: previews only. No
 * thread control or scheduled tasks (orchestration), no worktrees, no pull requests, no
 * devices. Edits the set in place so the upstream seam stays one line.
 */
export function keepFamilyMcpCapabilities<C extends string>(capabilities: Set<C>): Set<C> {
  for (const capability of capabilities) {
    if (capability !== "preview") capabilities.delete(capability);
  }
  return capabilities;
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
    /** Cheap: one stat when the file has not changed. False when the file is missing or unreadable. */
    readonly isEnabled: Effect.Effect<boolean>;
    readonly enable: (input: {
      readonly code: string;
      readonly childName: string | null;
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
    readonly rename: (input: {
      readonly childName: string | null;
    }) => Effect.Effect<FamilyStatus, FamilyError>;
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
  }
>()("t3/skycot/SkycotFamily") {}

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

function toStatus(file: FamilyFile | null, now: number): FamilyStatus {
  if (file === null || !file.enabled) {
    return {
      enabled: false,
      childName: null,
      createdAt: null,
      attemptsLeft: MAX_ATTEMPTS,
      lockedForMs: 0,
    };
  }
  const lockedForMs = lockRemainingMs(file, now);
  const failed = file.lockedUntil !== null && lockedForMs === 0 ? 0 : file.failedAttempts;
  return {
    enabled: true,
    childName: file.childName,
    createdAt: file.createdAt,
    attemptsLeft: lockedForMs > 0 ? 0 : Math.max(0, MAX_ATTEMPTS - failed),
    lockedForMs,
  };
}

function cleanChildName(name: string | null): string | null {
  const trimmed = name?.replace(/\s+/g, " ").trim() ?? "";
  return trimmed.length === 0 ? null : trimmed.slice(0, CHILD_NAME_MAX);
}

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
    const decoded = decodeFamilyFile(raw);
    const file = decoded._tag === "Some" ? decoded.value : null;
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
      const cleared = { ...base, failedAttempts: 0, lockedUntil: null };
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
    const file: FamilyFile = {
      version: 1,
      enabled: true,
      childName: cleanChildName(input.childName),
      codeHash: yield* hashCode(input.code, salt),
      salt,
      createdAt: DateTime.formatIso(DateTime.makeUnsafe(at)),
      failedAttempts: 0,
      lockedUntil: null,
      tokenSecret: hex(NodeCrypto.randomBytes(32)),
      grants: [],
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
        // A new code ends every grant and token issued under the old one.
        tokenSecret: hex(NodeCrypto.randomBytes(32)),
        grants: [],
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
    const next = { ...file, childName: cleanChildName(input.childName) };
    yield* save(next);
    return toStatus(next, yield* now);
  }, lock.withPermits(1));

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

  return SkycotFamily.of({
    status,
    openGrants,
    isEnabled,
    enable,
    verify,
    disable,
    changeCode,
    rename,
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
