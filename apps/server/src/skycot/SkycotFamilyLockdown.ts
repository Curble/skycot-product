// nondev-seam: skycot-policy-files
// Family lockdown: while the Family profile is on, a child's assistant gets only what SKYCOT
// gives it. None of the parent's own AI add-ons reach it: plugins, apps and connectors, MCP
// servers, skills, hooks, or the "notify" program Codex runs after every turn (which on Mark's
// Mac starts computer-use helpers). A written instruction is not enough, because computer use
// and browser control go around everything else the engine enforces.
//
// Where it is decided: at the provider session, below every caller. `lockRegistry` wraps the
// adapter registry ProviderSessionManager opens sessions from (seam skycot-family-lockdown), so
// every session open asks the profile first:
//   - profile on, provider SKYCOT can lock down (Codex, Claude): the adapter's `openSession`
//     runs with a `FamilyLockdown` value in context; the adapter reads it once
//     (`sessionLockdown`) and applies it to the process it starts and to every thread and query
//     (SkycotFamilyCodex, SkycotFamilyClaude). The returned runtime is remembered as locked.
//   - profile on, any other provider: refused before anything starts, with a plain sentence a
//     grown-up can act on, unless a grown-up allowed that provider for the Family profile with
//     the parent code (SkycotFamily `allowAssistant`, after the client showed its age terms and
//     that its add-ons stay on). An allowed provider opens unlocked, as the parent's informed
//     choice; SKYCOT's other Family rules still apply to it. Fail closed: a provider nobody
//     allowed never runs for a child, including new providers an upstream merge adds.
//   - profile off: the session opens exactly as upstream would. Its runtime is wrapped so that
//     if the profile is switched on while it is still live, it refuses new threads, turns,
//     follow-ups and MCP-app calls instead of running them with the parent's add-ons.
//
// A session that was already live when the profile changed: ProviderSessionManager asks
// `releaseIfMismatched` before reusing one (seam skycot-family-lockdown-restart). An unlocked
// session is closed the moment the profile is on, so the child's next turn starts a fresh,
// locked process; a locked one is closed once it is idle after the profile goes off, so the
// parent gets their own setup back. Between the two, the guard above refuses. An unlocked
// session of an allowed provider is kept while the profile is on; once the allowance is taken
// back it is closed like any other unlocked one, so its next Family turn is refused.

import { ProviderDriverKind } from "@t3tools/contracts";
import {
  assistantName,
  LOCKED_DOWN_ASSISTANTS,
  notAllowedSentence,
} from "@t3tools/skycot-rules/assistants";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as SkycotFamily from "./SkycotFamily.ts";

/**
 * Providers whose adapter applies the lockdown. Every other one is refused in Family unless a
 * grown-up allowed it (`allowedUnlocked`).
 */
export const LOCKED_DOWN_DRIVERS: ReadonlySet<ProviderDriverKind> = new Set(
  LOCKED_DOWN_ASSISTANTS.map((driver) => ProviderDriverKind.make(driver)),
);

export function providerName(driver: string): string {
  return assistantName(driver);
}

/**
 * Whether this provider may run unlocked for a child: one SKYCOT can't lock down that a
 * grown-up allowed. Never true for Codex or Claude, which always run locked in Family.
 */
export const allowedUnlocked = (
  family: SkycotFamily.SkycotFamily["Service"],
  driver: string,
): Effect.Effect<boolean> =>
  LOCKED_DOWN_DRIVERS.has(ProviderDriverKind.make(driver))
    ? Effect.succeed(false)
    : family.assistantAllowed(driver);

/** What an adapter is handed while the profile is on. Today it carries no options. */
export class FamilyLockdown {
  readonly driver: ProviderDriverKind;
  constructor(driver: ProviderDriverKind) {
    this.driver = driver;
  }
}

export const FamilyLockdownRef = Context.Reference<FamilyLockdown | null>("skycot/FamilyLockdown", {
  defaultValue: () => null,
});

/**
 * Adapter side, read once at the top of `openSession`: the lockdown this session must apply,
 * or null when the profile was off when it opened. Read it there and keep it in the session:
 * later calls run in other fibers that do not carry it.
 */
export const sessionLockdown: Effect.Effect<FamilyLockdown | null> =
  Effect.service(FamilyLockdownRef);

export type FamilyLockdownRefusal = "unsupported-provider" | "switched-on-mid-session";

export function familyLockdownSentence(driver: string, reason: FamilyLockdownRefusal): string {
  const name = providerName(driver);
  return reason === "unsupported-provider"
    ? notAllowedSentence(driver)
    : `The Family profile was switched on while ${name} was already running with this computer's own add-ons. SKYCOT stopped it so it can start again without them: send the message again.`;
}

/** An open refused by the lockdown. Its message is the plain sentence the chat shows. */
export class FamilyLockdownOpenRefused extends ProviderAdapter.ProviderAdapterOpenSessionError {
  override get message(): string {
    return familyLockdownSentence(this.driver, "unsupported-provider");
  }
}

/**
 * A call on an unlocked session while the profile is on: one opened before it was switched on
 * (Codex, Claude: it restarts locked), or one whose allowance was taken back (the others).
 */
export class FamilyLockdownCallRefused extends ProviderAdapter.ProviderAdapterProtocolError {
  override get message(): string {
    return familyLockdownSentence(
      this.driver,
      LOCKED_DOWN_DRIVERS.has(this.driver) ? "switched-on-mid-session" : "unsupported-provider",
    );
  }
}

const lockedRuntimes = new WeakSet<object>();

/** True when this runtime was opened under the lockdown. */
export function isLocked(runtime: object): boolean {
  return lockedRuntimes.has(runtime);
}

/** Test helper and adapter-agnostic marker: remember a runtime as opened under the lockdown. */
export function markLocked<R extends object>(runtime: R): R {
  lockedRuntimes.add(runtime);
  return runtime;
}

type Runtime = ProviderAdapter.ProviderAdapterV2SessionRuntime;

/**
 * An unlocked runtime that refuses work while the profile is on, unless its provider is one a
 * grown-up allowed (checked on every call, so taking the allowance back counts at once).
 * Interrupting, answering a pending request, reading and closing still work, so a grown-up can
 * stop what was running.
 */
export function guardUnlockedRuntime(
  family: SkycotFamily.SkycotFamily["Service"],
  runtime: Runtime,
): Runtime {
  const refuseWhileOn = Effect.fn("SkycotFamilyLockdown.refuseWhileOn")(function* <A, E>(
    effect: Effect.Effect<A, E>,
  ): Effect.fn.Return<A, E | FamilyLockdownCallRefused> {
    if (!(yield* family.isEnabled)) return yield* effect;
    if (yield* allowedUnlocked(family, runtime.driver)) return yield* effect;
    yield* Effect.logWarning("skycot-family.lockdown.refused-unlocked-session", {
      driver: runtime.driver,
      providerSessionId: runtime.providerSessionId,
    });
    return yield* new FamilyLockdownCallRefused({
      driver: runtime.driver,
      detail: "unlocked session while the Family profile is on",
    });
  });
  const mcpApps = runtime.mcpApps;
  return {
    ...runtime,
    ensureThread: (input) => refuseWhileOn(runtime.ensureThread(input)),
    resumeThread: (input) => refuseWhileOn(runtime.resumeThread(input)),
    forkThread: (input) => refuseWhileOn(runtime.forkThread(input)),
    startTurn: (input) => refuseWhileOn(runtime.startTurn(input)),
    steerTurn: (input) => refuseWhileOn(runtime.steerTurn(input)),
    ...(runtime.compactThread === undefined
      ? {}
      : { compactThread: (input) => refuseWhileOn(runtime.compactThread!(input)) }),
    ...(runtime.injectHistory === undefined
      ? {}
      : { injectHistory: (input) => refuseWhileOn(runtime.injectHistory!(input)) }),
    ...(mcpApps === undefined
      ? {}
      : {
          mcpApps: {
            listTools: (input) => refuseWhileOn(mcpApps.listTools(input)),
            callTool: (input) => refuseWhileOn(mcpApps.callTool(input)),
            readResource: (input) => refuseWhileOn(mcpApps.readResource(input)),
          },
        }),
  };
}

type Adapter = ProviderAdapter.ProviderAdapterV2["Service"];

/** The adapter with its `openSession` deciding the lockdown (see the header). */
export function lockAdapter(
  family: SkycotFamily.SkycotFamily["Service"],
  adapter: Adapter,
): Adapter {
  return {
    ...adapter,
    openSession: Effect.fn("SkycotFamilyLockdown.openSession")(function* (
      input: Parameters<Adapter["openSession"]>[0],
    ) {
      if (!(yield* family.isEnabled)) {
        return guardUnlockedRuntime(family, yield* adapter.openSession(input));
      }
      if (!LOCKED_DOWN_DRIVERS.has(adapter.driver)) {
        if (yield* allowedUnlocked(family, adapter.driver)) {
          // The grown-up's informed choice: started as upstream would, add-ons and all.
          yield* Effect.logInfo("skycot-family.lockdown.session-allowed-unlocked", {
            driver: adapter.driver,
            providerSessionId: input.providerSessionId,
          });
          return guardUnlockedRuntime(family, yield* adapter.openSession(input));
        }
        yield* Effect.logWarning("skycot-family.lockdown.refused-provider", {
          driver: adapter.driver,
          providerSessionId: input.providerSessionId,
        });
        return yield* new FamilyLockdownOpenRefused({
          driver: adapter.driver,
          providerSessionId: input.providerSessionId,
        });
      }
      const runtime = yield* adapter
        .openSession(input)
        .pipe(Effect.provideService(FamilyLockdownRef, new FamilyLockdown(adapter.driver)));
      yield* Effect.logInfo("skycot-family.lockdown.session-locked", {
        driver: adapter.driver,
        providerSessionId: input.providerSessionId,
      });
      return markLocked(runtime);
    }),
  };
}

type Registry = ProviderAdapterRegistry.ProviderAdapterRegistryV2["Service"];

/**
 * ProviderSessionManager's registry with every adapter locked. The same registry when the
 * service is absent (stock T3 Code, upstream tests).
 */
export const lockRegistry = (registry: Registry): Effect.Effect<Registry> =>
  Effect.map(Effect.serviceOption(SkycotFamily.SkycotFamily), (family) =>
    Option.isNone(family)
      ? registry
      : {
          ...registry,
          get: (instanceId) =>
            registry
              .get(instanceId)
              .pipe(Effect.map((adapter) => lockAdapter(family.value, adapter))),
        },
  );

/**
 * Before ProviderSessionManager reuses a live session: close it when it does not match the
 * profile. Unlocked while the profile is on: always (a turn it is running stops; the child's
 * next message starts a locked one, or is refused), except for a provider a grown-up allowed.
 * Locked while the profile is off: once nothing runs on it.
 */
export const releaseIfMismatched = <E>(
  family: Option.Option<SkycotFamily.SkycotFamily["Service"]>,
  entry:
    | {
        readonly runtime: { readonly driver: string };
        readonly busyTurns: ReadonlySet<string>;
      }
    | undefined,
  release: (detail: string) => Effect.Effect<void, E>,
): Effect.Effect<void, E> =>
  Option.isNone(family) || entry === undefined
    ? Effect.void
    : Effect.gen(function* () {
        const on = yield* family.value.isEnabled;
        const locked = isLocked(entry.runtime);
        if (on && !locked && !(yield* allowedUnlocked(family.value, entry.runtime.driver))) {
          yield* Effect.logInfo("skycot-family.lockdown.restart-unlocked-session");
          yield* release(
            "The Family profile is on: SKYCOT restarts this assistant without the computer's own add-ons.",
          );
        } else if (!on && locked && entry.busyTurns.size === 0) {
          yield* Effect.logInfo("skycot-family.lockdown.restart-locked-session");
          yield* release(
            "The Family profile is off: SKYCOT restarts this assistant with the computer's own setup.",
          );
        }
      });
