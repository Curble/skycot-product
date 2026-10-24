// The Family limits on this device: the engine's last word about the child using SKYCOT here,
// kept fresh by a heartbeat twice a minute (which is also how active minutes are counted), and
// every child's day for Settings › Family. One timer for the heartbeat and one for the next
// wall-clock change the engine named (bedtime starting, extra time ending); no polling beyond.
import { useSyncExternalStore } from "react";

import { familyApi, request } from "../family/api";

import { applySession, readFamilyView } from "../family/store";
import type { FamilyResult } from "../family/family";
import { parseLimitState, type LimitState, type SessionLimits } from "./limits";
import { withStarter } from "./order";

/** Twice a minute, so every minute of use gets at least one; the engine counts each minute once. */
export const HEARTBEAT_MS = 30_000;
/** Touched or typed within this long counts as using SKYCOT. */
export const ACTIVE_WITHIN_MS = 2 * 60_000;

export interface MoreTimeEntry {
  readonly at: number;
  readonly kind: "extra" | "endBedtime";
  readonly minutes: number | null;
}

/** A turn SKYCOT moved to another company while the one in use was resting (driver ids). */
export interface SwitchEntry {
  readonly at: number;
  readonly from: string;
  readonly to: string;
}

export interface ChildToday {
  readonly childId: string;
  readonly limits: LimitState;
  readonly moreTime: ReadonlyArray<MoreTimeEntry>;
  /** Older engines leave it out: read as none. */
  readonly switches: ReadonlyArray<SwitchEntry>;
}

export interface FamilyToday {
  readonly children: ReadonlyArray<ChildToday>;
  /** Who started each conversation, by thread id. */
  readonly threads: Readonly<Record<string, string>>;
  readonly projects: Readonly<Record<string, string>>;
}

const EMPTY_TODAY: FamilyToday = { children: [], threads: {}, projects: {} };

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const stringMap = (value: unknown): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(record(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

export function parseToday(body: unknown): FamilyToday | null {
  const input = record(body);
  if (!Array.isArray(input["children"])) return null;
  return {
    children: input["children"].flatMap((entry: unknown) => {
      const child = record(entry);
      const limits = parseLimitState(child["limits"]);
      if (typeof child["childId"] !== "string" || limits === null) return [];
      const moreTime = Array.isArray(child["moreTime"])
        ? child["moreTime"].flatMap((logged: unknown) => {
            const item = record(logged);
            return typeof item["at"] === "number" &&
              (item["kind"] === "extra" || item["kind"] === "endBedtime")
              ? [
                  {
                    at: item["at"],
                    kind: item["kind"],
                    minutes: typeof item["minutes"] === "number" ? item["minutes"] : null,
                  } satisfies MoreTimeEntry,
                ]
              : [];
          })
        : [];
      const switches = Array.isArray(child["switches"])
        ? child["switches"].flatMap((logged: unknown) => {
            const item = record(logged);
            return typeof item["at"] === "number" &&
              typeof item["from"] === "string" &&
              typeof item["to"] === "string"
              ? [{ at: item["at"], from: item["from"], to: item["to"] } satisfies SwitchEntry]
              : [];
          })
        : [];
      return [{ childId: child["childId"], limits, moreTime, switches }];
    }),
    threads: stringMap(input["threads"]),
    projects: stringMap(input["projects"]),
  };
}

interface LimitsSnapshot {
  readonly session: SessionLimits | null;
  readonly today: FamilyToday;
}

let snapshot: LimitsSnapshot = { session: null, today: EMPTY_TODAY };
const listeners = new Set<() => void>();

function set(next: Partial<LimitsSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readLimits(): LimitsSnapshot {
  return snapshot;
}

export function useLimits(): LimitsSnapshot {
  return useSyncExternalStore(subscribe, readLimits, readLimits);
}

/** The engine's answer about this device, whichever call brought it. */
export function applySessionLimits(session: SessionLimits) {
  set({ session });
  applySession(session);
}

let lastInput = 0;

function active(now: number): boolean {
  return (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    now - lastInput < ACTIVE_WITHIN_MS
  );
}

export async function heartbeat(): Promise<void> {
  if (!readFamilyView().enabled) return;
  const result = await familyApi.heartbeat({ active: active(Date.now()) });
  if (result.ok) applySessionLimits(result.value);
}

export async function refreshToday(): Promise<FamilyToday | null> {
  if (!readFamilyView().enabled) return null;
  const result = await request("GET", "/today", undefined, parseToday);
  if (result.ok) set({ today: result.value });
  return result.ok ? result.value : null;
}

/**
 * A conversation this device just started is the current child's: the engine records it that
 * way as it starts, so the list can say so now instead of waiting for the next read.
 */
export function noteStartedHere(threadId: string): void {
  const childId = readFamilyView().currentChildId;
  if (!readFamilyView().enabled || childId === null) return;
  const threads = withStarter(snapshot.today.threads, threadId, childId);
  if (threads !== snapshot.today.threads) set({ today: { ...snapshot.today, threads } });
}

// Ids already asked about, so a conversation from before anyone was chosen (which the engine
// never names) costs one read per page load, not one per render.
const askedAbout = new Set<string>();

/** Reads who started what again when the list shows a conversation this device can't place. */
export function askWhoStarted(threadIds: ReadonlyArray<string>): void {
  const fresh = threadIds.filter((threadId) => !askedAbout.has(threadId));
  if (fresh.length === 0 || !readFamilyView().enabled) return;
  for (const threadId of fresh) askedAbout.add(threadId);
  void refreshToday();
}

export async function chooseChild(childId: string): Promise<FamilyResult<SessionLimits>> {
  const result = await familyApi.choose({ childId });
  if (result.ok) applySessionLimits(result.value);
  return result;
}

export async function giveMoreTime(input: {
  readonly childId: string;
  readonly kind: "extra15" | "extra30" | "endBedtime";
  readonly code: string;
}): Promise<FamilyResult<SessionLimits>> {
  const result = await familyApi.moreTime(input);
  if (result.ok) {
    // The answer is for this device's child; another child's extra time shows in Settings.
    if (result.value.childId === readFamilyView().currentChildId) applySessionLimits(result.value);
    void refreshToday();
  }
  return result;
}

/**
 * Runs while the Family profile is on: the heartbeat, input tracking for "active", a beat when
 * the window comes back, and one timer to the next change the engine named. Returns the stop.
 */
export function startLimitsClock(): () => void {
  const onInput = () => {
    const was = active(Date.now());
    lastInput = Date.now();
    // Coming back after a pause: say so now rather than at the next beat.
    if (!was) void heartbeat();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") void heartbeat();
  };
  const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
  for (const event of events)
    window.addEventListener(event, onInput, { passive: true, capture: true });
  document.addEventListener("visibilitychange", onVisible);
  lastInput = Date.now();
  const beat = window.setInterval(() => void heartbeat(), HEARTBEAT_MS);
  let changeTimer: number | null = null;
  const armChange = () => {
    if (changeTimer !== null) window.clearTimeout(changeTimer);
    changeTimer = null;
    const changesAt = snapshot.session?.limits?.changesAt ?? null;
    if (changesAt === null) return;
    // setTimeout's ceiling is ~24.8 days; a day is all that is ever needed here.
    const delay = Math.min(24 * 60 * 60_000, Math.max(1_000, changesAt - Date.now() + 1_000));
    changeTimer = window.setTimeout(() => void heartbeat(), delay);
  };
  const unsubscribe = subscribe(armChange);
  void heartbeat();
  void refreshToday();
  return () => {
    for (const event of events) window.removeEventListener(event, onInput, { capture: true });
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(beat);
    if (changeTimer !== null) window.clearTimeout(changeTimer);
    unsubscribe();
  };
}
