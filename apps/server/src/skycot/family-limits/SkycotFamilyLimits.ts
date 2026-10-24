// The Family profile's daily side, kept by the engine: who is using SKYCOT on each signed-in
// device, which child started each conversation and project, each child's counters for today,
// and every "more time" a grown-up gave (for the parent's recap). The limits themselves are
// part of the profile (SkycotFamily); this service counts against them and says whether
// SKYCOT is awake. SkycotFamilyGate asks it at every turn start.
//
// Kept apart from the profile file because it changes every minute while a child is using
// SKYCOT, and the profile file is re-read whenever it changes. Tied to one profile by its
// creation time: a profile turned off and on again starts with empty counters and owners.
// Unreadable or missing means empty, never "asleep" (a broken file must not lock a child out
// for good; deleting it resets today's counters, which is inside the documented honesty).

// Random temp-file names; no Effect counterpart is needed for one call.
// @effect-diagnostics nodeBuiltinImport:off
// Formatting a wake-up time in the household's zone is Intl's job, and Intl speaks `Date`.
// @effect-diagnostics globalDate:off
import * as NodeCrypto from "node:crypto";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../../config.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
import * as SkycotFamilyIdentity from "../family-devices/SkycotFamilyIdentity.ts";
import {
  SWITCH_FILE_NAME,
  readSwitchFile,
  switchesForThread,
  type SwitchEntry,
} from "../model-fallback/switchLog.ts";
import {
  allowanceReading,
  applyMoreTime,
  countMinute,
  countTurn,
  dayAt,
  evaluateLimits,
  type AllowanceReading,
  type ChildDay,
  type LimitReason,
  type LimitState,
  type MoreTime,
} from "./limits.ts";

export const ACTIVITY_FILE_NAME = "skycot-family-activity.json";
const LOG_KEEP = 200;
const LOG_DAYS = 30;
/** Past days kept per child, for the weekly recap (a little over a month). */
const HISTORY_KEEP = 35;
const EVENTS_KEEP = 500;

const Day = Schema.Struct({
  date: Schema.String,
  minutes: Schema.Number,
  lastMinute: Schema.NullOr(Schema.Number),
  turns: Schema.Number,
  passUntil: Schema.NullOr(Schema.Number),
  bedtimeSkippedUntil: Schema.NullOr(Schema.Number),
});

const LogEntry = Schema.Struct({
  at: Schema.Number,
  childId: Schema.String,
  kind: Schema.Literals(["extra", "endBedtime"]),
  minutes: Schema.optionalKey(Schema.Number),
  /** What SKYCOT was stopping for when the grown-up stepped in; null when it was still awake. */
  reason: Schema.NullOr(Schema.Literals(["bedtime", "time", "turns", "allowance"])),
});
export type MoreTimeLogEntry = typeof LogEntry.Type;

/** A finished day's counters, kept for the recap after "today" starts again. */
const PastDay = Schema.Struct({
  date: Schema.String,
  minutes: Schema.Number,
  turns: Schema.Number,
});
export type PastDay = typeof PastDay.Type;

/**
 * What needed a grown-up, for the parent's recap: a held step a grown-up allowed, a personal
 * detail the shield caught (kinds only, never the words), and a message a grown-up let go as
 * typed.
 */
export const FAMILY_EVENT_KINDS = ["approved", "shield", "shield-allowed", "declined"] as const;
/** A grown-up's device that answered a request: who and which device, by name as it was then. */
const FamilyEventBy = Schema.Struct({
  personId: Schema.String,
  deviceId: Schema.String,
  deviceName: Schema.String,
  /** Said on the grown-up's Apple Watch and carried by that phone (Phase 4). */
  via: Schema.optionalKey(Schema.Struct({ kind: Schema.Literal("watch"), name: Schema.String })),
});
export type FamilyEventBy = typeof FamilyEventBy.Type;
const FamilyEvent = Schema.Struct({
  at: Schema.Number,
  childId: Schema.String,
  kind: Schema.Literals(FAMILY_EVENT_KINDS),
  categories: Schema.optionalKey(Schema.Array(Schema.String)),
  threadId: Schema.optionalKey(Schema.String),
  /** The one request a grown-up answered from their own device. */
  requestId: Schema.optionalKey(Schema.String),
  by: Schema.optionalKey(FamilyEventBy),
});
export type FamilyEvent = typeof FamilyEvent.Type;
export type FamilyEventKind = FamilyEvent["kind"];

const ActivityFile = Schema.Struct({
  version: Schema.Literal(1),
  profileCreatedAt: Schema.String,
  sessions: Schema.Record(Schema.String, Schema.String),
  threads: Schema.Record(Schema.String, Schema.String),
  projects: Schema.Record(Schema.String, Schema.String),
  days: Schema.Record(Schema.String, Day),
  /** The assistant each child last used, for the allowance reading between turns. */
  providers: Schema.Record(Schema.String, Schema.String),
  log: Schema.Array(LogEntry),
  /** Optional so a file from before the recap reads as it was. */
  history: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(PastDay))),
  events: Schema.optionalKey(Schema.Array(FamilyEvent)),
});
type ActivityFile = typeof ActivityFile.Type;

/**
 * The child's day replaced; a finished day that counted something moves into the history
 * first, so the weekly recap still has it after midnight.
 */
function withDay(activity: ActivityFile, childId: string, day: ChildDay): ActivityFile {
  const before = activity.days[childId];
  const history = { ...activity.history };
  if (
    before !== undefined &&
    before.date !== day.date &&
    (before.minutes > 0 || before.turns > 0)
  ) {
    history[childId] = [
      ...(history[childId] ?? []).filter((past) => past.date !== before.date),
      { date: before.date, minutes: before.minutes, turns: before.turns },
    ].slice(-HISTORY_KEEP);
  }
  return { ...activity, days: { ...activity.days, [childId]: day }, history };
}

/** Everything the recap reads, as the engine keeps it. */
export interface ActivitySnapshot {
  readonly threads: Readonly<Record<string, string>>;
  readonly projects: Readonly<Record<string, string>>;
  readonly days: Readonly<Record<string, ChildDay>>;
  readonly history: Readonly<Record<string, ReadonlyArray<PastDay>>>;
  readonly log: ReadonlyArray<MoreTimeLogEntry>;
  readonly events: ReadonlyArray<FamilyEvent>;
  /** Turns the model fallback moved to another company. Optional so older callers read unchanged. */
  readonly switches?: ReadonlyArray<AssistantSwitchNote>;
}

/**
 * A child's turn the engine moved to another company because the one they were using was out
 * of allowance (model-fallback/switchLog.ts writes them; this only reads). Driver ids: the
 * clients name the companies.
 */
export interface AssistantSwitchNote {
  readonly at: number;
  readonly childId: string;
  readonly threadId: string;
  readonly from: string;
  readonly to: string;
  /** When the first company's allowance comes back (epoch ms), when known. */
  readonly until: number | null;
}

const decodeActivity = Schema.decodeUnknownOption(Schema.fromJsonString(ActivityFile));

const encodeActivity = Schema.encodeEffect(Schema.fromJsonString(ActivityFile));

const emptyActivity = (profileCreatedAt: string): ActivityFile => ({
  version: 1,
  profileCreatedAt,
  sessions: {},
  threads: {},
  projects: {},
  days: {},
  providers: {},
  log: [],
});

/**
 * Why a turn (or switching away) was refused; "who" means no child is chosen on this device, and
 * "device" that this is a child's own device and someone else was picked without a grown-up.
 */
export type RefusalReason = LimitReason | "who" | "device";

export class FamilyLimitRefusal extends Schema.TaggedError<FamilyLimitRefusal>()(
  "SkycotFamilyLimitRefusal",
  {
    reason: Schema.Literals(["bedtime", "time", "turns", "allowance", "who", "device"]),
    sentence: Schema.String,
  },
) {
  override get message(): string {
    return this.sentence;
  }
}

/** "7:00 am" in the household's zone. */
export function clockPhrase(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(at))
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** The engine's own sentence for a refusal; the client shows a friendlier screen beside it. */
export function asleepSentence(
  reason: RefusalReason,
  state: LimitState | null,
  limits: SkycotFamily.ChildLimits | null,
  timeZone: string,
): string {
  const wakes = state?.wakesAt ? ` until ${clockPhrase(state.wakesAt, timeZone)}` : "";
  switch (reason) {
    case "who":
      return "Choose who's using SKYCOT first.";
    case "device":
      return "This device belongs to one child. A grown-up can change whose it is with the parent code.";
    case "bedtime":
      return `It's bedtime, so SKYCOT is asleep${wakes}. A grown-up can give more time.`;
    case "time":
      return `That's ${limits?.dailyMinutes ? `today's ${limits.dailyMinutes} minutes of SKYCOT` : "today's time on SKYCOT"}, so it's asleep${wakes}. A grown-up can give more time.`;
    case "turns":
      return `That's ${limits?.dailyTurns ? `today's ${limits.dailyTurns} messages` : "today's messages"}, so SKYCOT is asleep${wakes}. A grown-up can give more time.`;
    case "allowance":
      return `SKYCOT is resting to leave some of the ${state?.allowance?.brand ?? "AI"} allowance for grown-ups. A grown-up can give more time.`;
  }
}

export interface ChildToday {
  readonly childId: string;
  readonly limits: LimitState;
  /** Today's "more time" from a grown-up, oldest first. */
  readonly moreTime: ReadonlyArray<MoreTimeLogEntry>;
  /** Today's turns moved to another company while the first one was resting, oldest first. */
  readonly switches: ReadonlyArray<AssistantSwitchNote>;
}

export interface SessionLimits {
  /** The child using SKYCOT on this device, or null while one has to be chosen (or the profile is off). */
  readonly childId: string | null;
  /** More than one child and none chosen here yet. */
  readonly needsChoice: boolean;
  /**
   * What kind of device this is: the family's Mac ("shared", with the picker), a child's own
   * device (always that child), or a grown-up's device (never a child, so no picker and no limits).
   */
  readonly device: "shared" | "child" | "grown-up";
  readonly limits: LimitState | null;
  /** The engine's sentence while asleep; null while awake. */
  readonly sentence: string | null;
}

export class SkycotFamilyLimits extends Context.Service<
  SkycotFamilyLimits,
  {
    readonly forSession: (input: { readonly sessionId: string }) => Effect.Effect<SessionLimits>;
    /**
     * The client's twice-a-minute "still here". `active` (on screen and touched lately) counts
     * this minute for the session's child.
     */
    readonly heartbeat: (input: {
      readonly sessionId: string;
      readonly active: boolean;
    }) => Effect.Effect<SessionLimits>;
    /**
     * "Who's using SKYCOT?" for this device. Free, except moving away from a child SKYCOT is
     * asleep for, which needs a grown-up (otherwise bedtime is one tap away).
     */
    readonly choose: (input: {
      readonly sessionId: string;
      readonly childId: string;
      readonly grownUp: boolean;
    }) => Effect.Effect<SessionLimits, FamilyLimitRefusal | SkycotFamily.FamilyError>;
    /**
     * The providers this conversation's turn may start on right now, judged exactly as
     * `admitTurn` judges a child's turn start (bedtime, daily time, messages a day, the
     * allowance line on that provider), without counting anything. All of them when the profile
     * is off or the conversation is no child's. For engine parts below the gate: the model
     * fallback carries a stopped turn on only where the child could start one.
     */
    readonly startableOn: (input: {
      readonly threadId: string;
      readonly instanceIds: ReadonlyArray<string>;
    }) => Effect.Effect<ReadonlySet<string>>;
    /** A turn is about to start: refuses while asleep, otherwise counts it. */
    readonly admitTurn: (input: {
      readonly sessionId: string;
      readonly instanceId?: string | undefined;
    }) => Effect.Effect<void, FamilyLimitRefusal>;
    /** A child allowing the next step of a turn: refused while asleep, never counted. */
    readonly admitStep: (input: {
      readonly sessionId: string;
    }) => Effect.Effect<void, FamilyLimitRefusal>;
    /** Remembers which child started a conversation or project (the first answer stands). */
    readonly recordStart: (input: {
      readonly sessionId: string;
      readonly threadId?: string | undefined;
      readonly projectId?: string | undefined;
    }) => Effect.Effect<void>;
    /** A grown-up's "more time" with the parent code; logged for the recap. */
    readonly moreTime: (input: {
      readonly sessionId: string;
      readonly childId: string;
      readonly code: string;
      readonly more: MoreTime;
    }) => Effect.Effect<SessionLimits, SkycotFamily.FamilyError>;
    /**
     * The same "more time", for a grown-up the engine already knows said yes (their own phone,
     * with its passkey or the code checked by the caller). Logged for the recap.
     */
    readonly grantMoreTime: (input: {
      readonly sessionId: string;
      readonly childId: string;
      readonly more: MoreTime;
    }) => Effect.Effect<SessionLimits, SkycotFamily.FamilyError>;
    /** Notes something that needed a grown-up for the session's child (the recap reads it). */
    readonly recordEvent: (input: {
      readonly sessionId: string;
      readonly kind: FamilyEventKind;
      readonly categories?: ReadonlyArray<string> | undefined;
      readonly threadId?: string | undefined;
      /** The child it is about, when that is not the session's (a grown-up's phone said yes). */
      readonly childId?: string | undefined;
      /** The one request a grown-up answered. */
      readonly requestId?: string | undefined;
      /** Who said yes, from which device (a grown-up's phone). */
      readonly by?: FamilyEventBy | undefined;
    }) => Effect.Effect<void>;
    /** The profile and its activity as kept, for the recap; null while the profile is off. */
    readonly snapshot: Effect.Effect<{
      readonly profile: SkycotFamily.FamilyStatus;
      readonly activity: ActivitySnapshot;
    } | null>;
    /** Every child's day, for Settings › Family, and who started what. */
    readonly today: Effect.Effect<{
      readonly children: ReadonlyArray<ChildToday>;
      readonly threads: Readonly<Record<string, string>>;
      readonly projects: Readonly<Record<string, string>>;
    }>;
    /** Every model switch in one conversation, for its plain "… is resting" lines. */
    readonly switchesFor: (threadId: string) => Effect.Effect<ReadonlyArray<SwitchEntry>>;
  }
>()("t3/skycot/family-limits/SkycotFamilyLimits") {}

type Profile = SkycotFamily.FamilyStatus;

/** The service over an activity file (also built read-only by the model fallback). */
export const makeAt = Effect.fn("SkycotFamilyLimits.make")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // The model fallback's notes sit beside this file; read here, never written here.
  const switchFile = readSwitchFile(path.join(path.dirname(filePath), SWITCH_FILE_NAME)).pipe(
    Effect.provideService(FileSystem.FileSystem, fs),
  );
  const crossSwitches = (activity: ActivityFile) =>
    switchFile.pipe(
      Effect.map((file) =>
        file.switches.flatMap((entry): ReadonlyArray<AssistantSwitchNote> => {
          const childId = entry.crossProvider ? activity.threads[entry.threadId] : undefined;
          return childId === undefined
            ? []
            : [
                {
                  at: entry.at,
                  childId,
                  threadId: entry.threadId,
                  from: entry.from.driver,
                  to: entry.to.driver,
                  until: entry.until,
                },
              ];
        }),
      ),
    );
  const family = yield* SkycotFamily.SkycotFamily;
  // Optional: without provider snapshots (tests, a stripped-down server) the allowance guard
  // simply has no reading, and the other limits still apply.
  const registry = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
  // Optional: without it (older tests, tools) every session is the family's Mac, as before.
  const identities = yield* Effect.serviceOption(SkycotFamilyIdentity.SkycotFamilyIdentity);
  const identityOf = (sessionId: string) =>
    identities._tag === "Some"
      ? identities.value.identify(sessionId)
      : Effect.succeed<SkycotFamilyIdentity.FamilyIdentity>({ kind: "shared" });
  const lock = yield* Semaphore.make(1);
  const cache = yield* Ref.make<{ readonly stamp: string; readonly file: ActivityFile | null }>({
    stamp: "",
    file: null,
  });
  const now = Clock.currentTimeMillis;

  const readFile = Effect.gen(function* () {
    const info = yield* fs.stat(filePath).pipe(Effect.orElseSucceed(() => null));
    if (info === null) return null;
    const mtime = info.mtime._tag === "Some" ? info.mtime.value.getTime() : 0;
    const stamp = `${mtime}:${info.size}`;
    const cached = yield* Ref.get(cache);
    if (cached.stamp === stamp) return cached.file;
    const raw = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
    const decoded = decodeActivity(raw);
    const file = decoded._tag === "Some" ? decoded.value : null;
    yield* Ref.set(cache, { stamp, file });
    return file;
  });

  /** The activity for this profile; another profile's (or none) reads as empty. */
  const load = (profile: Profile) =>
    readFile.pipe(
      Effect.map((file) =>
        file !== null && file.profileCreatedAt === profile.createdAt
          ? file
          : emptyActivity(profile.createdAt ?? ""),
      ),
    );

  const save = Effect.fn("SkycotFamilyLimits.save")(
    function* (file: ActivityFile) {
      yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${NodeCrypto.randomBytes(6).toString("hex")}.tmp`;
      yield* fs.writeFileString(temp, `${yield* encodeActivity(file)}\n`, { mode: 0o600 });
      yield* fs.rename(temp, filePath);
      yield* Ref.set(cache, { stamp: "", file: null });
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not save the Family activity file.", { cause }),
    ),
  );

  const profileStatus = family.status.pipe(Effect.orElseSucceed(() => null));

  /**
   * The child using SKYCOT on this session: a child's own device is always that child, a
   * grown-up's device (or a removed one) is nobody's, and the Mac is whoever was picked.
   */
  const childFor = Effect.fnUntraced(function* (
    profile: Profile,
    activity: ActivityFile,
    sessionId: string,
  ) {
    const who = yield* identityOf(sessionId);
    if (who.kind === "child") {
      return profile.children.find((candidate) => candidate.id === who.childId) ?? null;
    }
    if (who.kind !== "shared") return null;
    const chosen = activity.sessions[sessionId];
    const child =
      profile.children.find((candidate) => candidate.id === chosen) ??
      (profile.children.length === 1 ? profile.children[0] : undefined);
    return child ?? null;
  });

  const deviceKindOf = (who: SkycotFamilyIdentity.FamilyIdentity): SessionLimits["device"] =>
    who.kind === "child" ? "child" : who.kind === "shared" ? "shared" : "grown-up";

  const readingFor = Effect.fnUntraced(function* (instanceId: string | undefined, at: number) {
    if (Option.isNone(registry)) return null;
    const providers = yield* registry.value.getProviders;
    const exact =
      instanceId === undefined
        ? undefined
        : providers.find((provider) => String(provider.instanceId) === instanceId);
    if (exact !== undefined) return allowanceReading(exact, at);
    // No conversation to go by: the tightest allowance among the assistants that are on.
    let lowest: AllowanceReading | null = null;
    for (const provider of providers) {
      if (!provider.enabled) continue;
      const reading = allowanceReading(provider, at);
      if (reading !== null && (lowest === null || reading.leftPercent < lowest.leftPercent)) {
        lowest = reading;
      }
    }
    return lowest;
  });

  const stateFor = Effect.fnUntraced(function* (
    profile: Profile,
    activity: ActivityFile,
    child: SkycotFamily.FamilyChild,
    at: number,
    instanceId?: string,
  ) {
    const allowance =
      child.limits.keepAllowancePercent === null
        ? null
        : yield* readingFor(instanceId ?? activity.providers[child.id], at);
    return evaluateLimits({
      limits: child.limits,
      day: activity.days[child.id],
      now: at,
      timeZone: profile.timeZone,
      allowance,
    });
  });

  const sessionView = Effect.fnUntraced(function* (
    profile: Profile | null,
    activity: ActivityFile | null,
    sessionId: string,
    at: number,
  ) {
    const who = yield* identityOf(sessionId);
    const device = deviceKindOf(who);
    if (profile === null || !profile.enabled || activity === null) {
      return {
        childId: null,
        needsChoice: false,
        device,
        limits: null,
        sentence: null,
      } satisfies SessionLimits;
    }
    const child = yield* childFor(profile, activity, sessionId);
    if (child === null) {
      return {
        childId: null,
        // A grown-up's device is never asked "Who's using SKYCOT?".
        needsChoice: device === "shared",
        device,
        limits: null,
        sentence: null,
      } satisfies SessionLimits;
    }
    const limits = yield* stateFor(profile, activity, child, at);
    return {
      childId: child.id,
      needsChoice: false,
      device,
      limits,
      sentence:
        limits.asleep && limits.reason !== null
          ? asleepSentence(limits.reason, limits, child.limits, profile.timeZone)
          : null,
    } satisfies SessionLimits;
  });

  const current = Effect.gen(function* () {
    const profile = yield* profileStatus;
    if (profile === null || !profile.enabled) return null;
    return { profile, activity: yield* load(profile) };
  });

  const forSession: SkycotFamilyLimits["Service"]["forSession"] = Effect.fn(
    "SkycotFamilyLimits.forSession",
  )(function* (input) {
    const loaded = yield* current;
    return yield* sessionView(
      loaded?.profile ?? null,
      loaded?.activity ?? null,
      input.sessionId,
      yield* now,
    );
  });

  const heartbeat: SkycotFamilyLimits["Service"]["heartbeat"] = Effect.fn(
    "SkycotFamilyLimits.heartbeat",
  )(function* (input) {
    const loaded = yield* current;
    const at = yield* now;
    if (loaded === null) return yield* sessionView(null, null, input.sessionId, at);
    let { activity } = loaded;
    const child = yield* childFor(loaded.profile, activity, input.sessionId);
    if (input.active && child !== null) {
      const before = activity.days[child.id];
      const after = countMinute(before, at, loaded.profile.timeZone);
      if (after !== before) {
        activity = withDay(activity, child.id, after);
        yield* save(activity);
      }
    }
    return yield* sessionView(loaded.profile, activity, input.sessionId, at);
  }, lock.withPermits(1));

  const choose: SkycotFamilyLimits["Service"]["choose"] = Effect.fn("SkycotFamilyLimits.choose")(
    function* (input) {
      const loaded = yield* current;
      if (loaded === null) return yield* new SkycotFamily.FamilyError({ reason: "not-enabled" });
      const { profile, activity } = loaded;
      const target = profile.children.find((child) => child.id === input.childId);
      if (target === undefined) {
        return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
      }
      const at = yield* now;
      const who = yield* identityOf(input.sessionId);
      if (who.kind === "grown-up" || who.kind === "removed") {
        return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
      }
      if (who.kind === "child") {
        // A child's own device is that child's. A grown-up (the parent code) can give it to
        // another child; nobody else can, whatever SKYCOT is doing for either of them.
        if (target.id !== who.childId) {
          if (!input.grownUp) {
            return yield* new FamilyLimitRefusal({
              reason: "device",
              sentence: asleepSentence("device", null, null, profile.timeZone),
            });
          }
          yield* family.reassignDevice({ deviceId: who.deviceId, childId: target.id });
          yield* Effect.logInfo("skycot-family.device-reassigned", { deviceId: who.deviceId });
        }
        return yield* sessionView(profile, activity, input.sessionId, at);
      }
      const from = yield* childFor(profile, activity, input.sessionId);
      if (from !== null && from.id !== target.id && !input.grownUp) {
        const state = yield* stateFor(profile, activity, from, at);
        if (state.asleep && state.reason !== null) {
          return yield* new FamilyLimitRefusal({
            reason: state.reason,
            sentence: `SKYCOT is asleep for ${from.name ?? "this child"}, so a grown-up switches to someone else.`,
          });
        }
      }
      const next: ActivityFile = {
        ...activity,
        sessions: { ...activity.sessions, [input.sessionId]: target.id },
      };
      if (activity.sessions[input.sessionId] !== target.id) yield* save(next);
      return yield* sessionView(profile, next, input.sessionId, at);
    },
    lock.withPermits(1),
  );

  const refuse = (
    profile: Profile,
    child: SkycotFamily.FamilyChild | null,
    state: LimitState | null,
  ) =>
    child === null
      ? new FamilyLimitRefusal({
          reason: "who",
          sentence: asleepSentence("who", null, null, profile.timeZone),
        })
      : new FamilyLimitRefusal({
          reason: state!.reason!,
          sentence: asleepSentence(state!.reason!, state, child.limits, profile.timeZone),
        });

  const admitTurn: SkycotFamilyLimits["Service"]["admitTurn"] = Effect.fn(
    "SkycotFamilyLimits.admitTurn",
  )(function* (input) {
    const loaded = yield* current;
    if (loaded === null) return;
    const { profile, activity } = loaded;
    const child = yield* childFor(profile, activity, input.sessionId);
    if (child === null) return yield* refuse(profile, null, null);
    const at = yield* now;
    const state = yield* stateFor(profile, activity, child, at, input.instanceId);
    if (state.asleep) {
      yield* Effect.logInfo("skycot-family.asleep", { childId: child.id, reason: state.reason });
      return yield* refuse(profile, child, state);
    }
    yield* save({
      ...withDay(activity, child.id, countTurn(activity.days[child.id], at, profile.timeZone)),
      providers:
        input.instanceId === undefined
          ? activity.providers
          : { ...activity.providers, [child.id]: input.instanceId },
    });
  }, lock.withPermits(1));

  const startableOn: SkycotFamilyLimits["Service"]["startableOn"] = Effect.fn(
    "SkycotFamilyLimits.startableOn",
  )(function* (input) {
    const all = new Set(input.instanceIds);
    const loaded = yield* current;
    if (loaded === null) return all;
    const { profile, activity } = loaded;
    const ownerId = activity.threads[input.threadId];
    const child = profile.children.find((candidate) => candidate.id === ownerId);
    if (child === undefined) return all;
    const at = yield* now;
    const startable = new Set<string>();
    for (const instanceId of input.instanceIds) {
      // The same judgement as admitTurn's, so the rules live in one place (evaluateLimits).
      const state = yield* stateFor(profile, activity, child, at, instanceId);
      if (!state.asleep) startable.add(instanceId);
    }
    return startable;
  });

  const admitStep: SkycotFamilyLimits["Service"]["admitStep"] = Effect.fn(
    "SkycotFamilyLimits.admitStep",
  )(function* (input) {
    const loaded = yield* current;
    if (loaded === null) return;
    const child = yield* childFor(loaded.profile, loaded.activity, input.sessionId);
    // No child chosen: the step belongs to a turn someone already started; let it be judged as usual.
    if (child === null) return;
    const state = yield* stateFor(loaded.profile, loaded.activity, child, yield* now);
    if (state.asleep) return yield* refuse(loaded.profile, child, state);
  });

  const recordStart: SkycotFamilyLimits["Service"]["recordStart"] = Effect.fn(
    "SkycotFamilyLimits.recordStart",
  )(function* (input) {
    const loaded = yield* current;
    if (loaded === null) return;
    const { activity } = loaded;
    const child = yield* childFor(loaded.profile, activity, input.sessionId);
    if (child === null) return;
    const newThread =
      input.threadId !== undefined && activity.threads[input.threadId] === undefined;
    const newProject =
      input.projectId !== undefined && activity.projects[input.projectId] === undefined;
    if (!newThread && !newProject) return;
    yield* save({
      ...activity,
      threads: newThread ? { ...activity.threads, [input.threadId!]: child.id } : activity.threads,
      projects: newProject
        ? { ...activity.projects, [input.projectId!]: child.id }
        : activity.projects,
    });
  }, lock.withPermits(1));

  const giveMoreTime = Effect.fn("SkycotFamilyLimits.giveMoreTime")(function* (input: {
    readonly sessionId: string;
    readonly childId: string;
    readonly code: string | null;
    readonly more: MoreTime;
  }) {
    const loaded = yield* current;
    if (loaded === null) return yield* new SkycotFamily.FamilyError({ reason: "not-enabled" });
    const child = loaded.profile.children.find((candidate) => candidate.id === input.childId);
    if (child === undefined) {
      return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
    }
    if (input.code !== null) yield* family.checkCode({ code: input.code });
    const at = yield* now;
    const { profile, activity } = loaded;
    const before = yield* stateFor(profile, activity, child, at);
    const day = applyMoreTime(
      activity.days[child.id],
      child.limits,
      input.more,
      at,
      profile.timeZone,
    );
    const entry: MoreTimeLogEntry = {
      at,
      childId: child.id,
      kind: input.more.type,
      ...(input.more.type === "extra" ? { minutes: input.more.minutes } : {}),
      reason: before.reason,
    };
    const next: ActivityFile = {
      ...withDay(activity, child.id, day),
      log: [...activity.log, entry]
        .filter((logged) => logged.at > at - LOG_DAYS * 24 * 60 * 60_000)
        .slice(-LOG_KEEP),
    };
    yield* save(next);
    yield* Effect.logInfo("skycot-family.more-time", { childId: child.id, kind: entry.kind });
    return yield* sessionView(profile, next, input.sessionId, at);
  }, lock.withPermits(1));

  const moreTime: SkycotFamilyLimits["Service"]["moreTime"] = (input) => giveMoreTime(input);
  const grantMoreTime: SkycotFamilyLimits["Service"]["grantMoreTime"] = (input) =>
    giveMoreTime({ ...input, code: null });

  const recordEvent: SkycotFamilyLimits["Service"]["recordEvent"] = Effect.fn(
    "SkycotFamilyLimits.recordEvent",
  )(function* (input) {
    const loaded = yield* current;
    if (loaded === null) return;
    const { activity } = loaded;
    const child =
      input.childId !== undefined
        ? (loaded.profile.children.find((candidate) => candidate.id === input.childId) ?? null)
        : yield* childFor(loaded.profile, activity, input.sessionId);
    if (child === null) return;
    const at = yield* now;
    const event: FamilyEvent = {
      at,
      childId: child.id,
      kind: input.kind,
      ...(input.categories && input.categories.length > 0
        ? { categories: [...input.categories] }
        : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.by ? { by: input.by } : {}),
    };
    yield* save({
      ...activity,
      events: [...(activity.events ?? []), event]
        .filter((logged) => logged.at > at - LOG_DAYS * 24 * 60 * 60_000)
        .slice(-EVENTS_KEEP),
    });
  }, lock.withPermits(1));

  const snapshot: SkycotFamilyLimits["Service"]["snapshot"] = Effect.gen(function* () {
    const loaded = yield* current;
    if (loaded === null) return null;
    const { activity } = loaded;
    return {
      profile: loaded.profile,
      activity: {
        threads: activity.threads,
        projects: activity.projects,
        days: activity.days,
        history: activity.history ?? {},
        log: activity.log,
        events: activity.events ?? [],
        switches: yield* crossSwitches(activity),
      },
    };
  }).pipe(Effect.withSpan("SkycotFamilyLimits.snapshot"));

  const today: SkycotFamilyLimits["Service"]["today"] = Effect.gen(function* () {
    const loaded = yield* current;
    if (loaded === null) return { children: [], threads: {}, projects: {} };
    const { profile, activity } = loaded;
    const at = yield* now;
    const switches = yield* crossSwitches(activity);
    const children: ChildToday[] = [];
    for (const child of profile.children) {
      const limits = yield* stateFor(profile, activity, child, at);
      const date = dayAt(activity.days[child.id], at, profile.timeZone).date;
      children.push({
        childId: child.id,
        limits,
        moreTime: activity.log.filter(
          (entry) =>
            entry.childId === child.id &&
            dayAt(undefined, entry.at, profile.timeZone).date === date,
        ),
        switches: switches.filter(
          (entry) =>
            entry.childId === child.id &&
            dayAt(undefined, entry.at, profile.timeZone).date === date,
        ),
      });
    }
    return { children, threads: activity.threads, projects: activity.projects };
  }).pipe(Effect.withSpan("SkycotFamilyLimits.today"));

  const switchesFor: SkycotFamilyLimits["Service"]["switchesFor"] = Effect.fn(
    "SkycotFamilyLimits.switchesFor",
  )(function* (threadId) {
    return switchesForThread(yield* switchFile, threadId);
  });

  return SkycotFamilyLimits.of({
    forSession,
    heartbeat,
    choose,
    admitTurn,
    startableOn,
    admitStep,
    recordStart,
    moreTime,
    grantMoreTime,
    recordEvent,
    snapshot,
    today,
    switchesFor,
  });
});

export type { ChildDay, LimitState, MoreTime };

/** For tests and tools: an activity file at an explicit path. */
export const layerAt = (filePath: string) => Layer.effect(SkycotFamilyLimits, makeAt(filePath));

/** The engine's activity file, beside the profile in `<T3 home>/userdata/`. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return layerAt(path.join(config.stateDir, ACTIVITY_FILE_NAME));
  }),
);
