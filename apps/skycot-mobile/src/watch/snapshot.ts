/**
 * The Watch's snapshot, made from what the phone already read from its Macs (src/data/MacData).
 * Only what the Watch shows goes: the waiting requests (which child, the phone's one-line
 * heading and the exact step), each child's time today and bedtime, and the lock. Never
 * conversations, projects, sign-ins or the Mac's address.
 */
import {
  avatarLetter,
  childLabel,
  type FamilyChild,
} from "../../../nondev/src/features/family/children";
import { grownUpLabel, requestHeading } from "../../../nondev/src/features/family/people";
import { durationPhrase, wallTimePhrase } from "../../../nondev/src/features/family-limits/limits";
import type { MacState } from "../data/MacData";
import type { DeviceMode, MacLink } from "../links/pairing";
import { AVATAR_COLORS } from "../ui/avatarColours";
import { WATCH_PROTOCOL, type WatchChild, type WatchRequest, type WatchSnapshot } from "./protocol";

/** A mascot picture has no colour of its own: the Watch shows its letter on SKYCOT's sky blue. */
export function childColour(child: Pick<FamilyChild, "avatar">): string {
  const swatch =
    child.avatar.kind === "initial" ? AVATAR_COLORS[child.avatar.color] : AVATAR_COLORS.sky;
  return (swatch ?? AVATAR_COLORS.sky!).dark;
}

export function timePhrase(usedMinutes: number, dailyMinutes: number | null): string {
  return dailyMinutes === null
    ? durationPhrase(usedMinutes)
    : `${durationPhrase(usedMinutes)} of ${durationPhrase(dailyMinutes)}`;
}

export function messagesPhrase(turns: number, dailyTurns: number | null): string {
  if (dailyTurns !== null) return `${turns} of ${dailyTurns} messages`;
  return `${turns} ${turns === 1 ? "message" : "messages"}`;
}

export function bedtimePhrase(child: Pick<FamilyChild, "limits">): string | null {
  const bedtime = child.limits.bedtime;
  return bedtime === null
    ? null
    : `Bedtime ${wallTimePhrase(bedtime.start)} to ${wallTimePhrase(bedtime.end)}`;
}

export function buildWatchSnapshot(input: {
  readonly mode: DeviceMode;
  readonly macs: ReadonlyArray<MacLink>;
  readonly byMac: Readonly<Record<string, MacState>>;
  readonly lockedAt: number | null;
  readonly now: number;
}): WatchSnapshot {
  const base = {
    protocol: WATCH_PROTOCOL,
    at: input.now,
    grownUpName: "Grown-up",
    requests: [],
    children: [],
    watchSetUp: false,
    lockedAt: input.lockedAt,
    reachable: false,
  } as const;
  if (input.mode === "unlinked") return { ...base, state: "not-linked" };
  // Children's own devices have no Watch app in v1 (see docs/nondev/WATCH.md).
  if (input.mode === "child") return { ...base, state: "child-device" };

  const several = input.macs.length > 1;
  const requests: Array<WatchRequest> = [];
  const children: Array<WatchChild> = [];
  let grownUpName: string | null = null;
  let setUpEverywhere = input.macs.length > 0;
  let reachable = false;

  for (const mac of input.macs) {
    const state = input.byMac[mac.macId];
    const status = state?.status ?? null;
    if (state?.reachable === true && status !== null) reachable = true;
    const myself = (status?.devices ?? []).find((device) => device.id === mac.me.deviceId) ?? null;
    const watchCanSayYes = myself?.watch !== null && myself?.watch !== undefined;
    if (!watchCanSayYes) setUpEverywhere = false;
    if (grownUpName === null && status !== null && mac.me.kind === "grown-up") {
      const people = status.grownUps ?? [];
      const personId = mac.me.personId;
      const index = people.findIndex((person) => person.id === personId);
      if (index >= 0) grownUpName = grownUpLabel(people[index]!, index);
    }
    const family = status?.children ?? [];
    const named = (id: string | null) => {
      const index = family.findIndex((child) => child.id === id);
      return index < 0 ? null : { child: family[index]!, label: childLabel(family[index]!, index) };
    };
    for (const request of state?.requests ?? []) {
      const who = named(request.childId);
      const name = who?.label ?? "A child";
      requests.push({
        id: `${mac.macId}:${request.requestId}`,
        macId: mac.macId,
        threadId: request.threadId,
        requestId: request.requestId,
        fingerprint: request.fingerprint,
        childName: name,
        childInitial: who ? avatarLetter(who.child) : "★",
        childColour: who ? childColour(who.child) : AVATAR_COLORS.sky!.dark,
        title: `${name} needs a grown-up`,
        heading: requestHeading(request),
        what: request.what,
        why: request.why,
        macName: several ? mac.macName : null,
        createdAt: request.createdAt,
        lapsed: request.lapsed,
        watchCanSayYes,
      });
    }
    family.forEach((child, index) => {
      const today =
        state?.today?.children.find((entry) => entry.childId === child.id)?.limits ?? null;
      children.push({
        id: child.id,
        macId: mac.macId,
        name: childLabel(child, index),
        initial: avatarLetter(child),
        colour: childColour(child),
        time: timePhrase(today?.usedMinutes ?? 0, child.limits.dailyMinutes),
        messages: messagesPhrase(today?.turns ?? 0, child.limits.dailyTurns),
        bedtime: bedtimePhrase(child),
        asleep: today?.asleep === true,
      });
    });
  }
  requests.sort((a, b) => b.createdAt - a.createdAt);
  return {
    ...base,
    state: "ready",
    grownUpName: grownUpName ?? "Grown-up",
    requests,
    children,
    watchSetUp: setUpEverywhere,
    reachable,
  };
}

/** The same snapshot, without its clock: to send the Watch only what changed. */
export function snapshotKey(snapshot: WatchSnapshot): string {
  const { at: _at, ...rest } = snapshot;
  return JSON.stringify(rest);
}
