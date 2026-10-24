// The one plain line a conversation shows when SKYCOT moved a turn to another model because the
// one in use was resting (out of allowance), instead of an error: "Claude's top helper is
// resting until Tuesday, so Sam is using Claude Sonnet for now." The engine decides and records
// each switch (apps/server skycot/model-fallback); this words it, with the crew's name, which
// only the client knows. Pure: callers pass `now`, the time zone and the provider snapshots.
import type { OrchestrationV2ThreadProjection, ServerProvider } from "@t3tools/contracts";

import { brandForDriver, modelOf, restingUntilPhrase } from "./usage";

/** The message id of a continuation the engine sent to carry a stopped turn on. */
export const SWITCH_MESSAGE_PREFIX = "skycot-switch:";

export interface SwitchEnd {
  readonly instanceId: string;
  readonly driver: string;
  readonly model: string;
}

export interface AssistantSwitch {
  /** The message that ran on the new model: the person's own, or the engine's continuation. */
  readonly messageId: string;
  readonly from: SwitchEnd;
  readonly to: SwitchEnd;
  /** When the model asked for comes back (epoch ms), when known. */
  readonly until: number | null;
  readonly crossProvider: boolean;
  /** The run a limit stopped, when this switch carried it on. */
  readonly continuationOf: string | null;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

function parseEnd(value: unknown): SwitchEnd | null {
  const end = record(value);
  return typeof end["instanceId"] === "string" &&
    typeof end["driver"] === "string" &&
    typeof end["model"] === "string"
    ? { instanceId: end["instanceId"], driver: end["driver"], model: end["model"] }
    : null;
}

/** The engine's `/assistant-switches` answer, or null when it is not one. */
export function parseAssistantSwitches(body: unknown): ReadonlyArray<AssistantSwitch> | null {
  const list = record(body)["switches"];
  if (!Array.isArray(list)) return null;
  return list.flatMap((value: unknown): ReadonlyArray<AssistantSwitch> => {
    const entry = record(value);
    const from = parseEnd(entry["from"]);
    const to = parseEnd(entry["to"]);
    if (typeof entry["messageId"] !== "string" || from === null || to === null) return [];
    return [
      {
        messageId: entry["messageId"],
        from,
        to,
        until: typeof entry["until"] === "number" ? entry["until"] : null,
        crossProvider: entry["crossProvider"] === true,
        continuationOf:
          typeof entry["continuationOf"] === "string" ? entry["continuationOf"] : null,
      },
    ];
  });
}

const providerOf = (providers: ReadonlyArray<ServerProvider>, end: SwitchEnd) =>
  providers.find((provider) => String(provider.instanceId) === end.instanceId);

/** "Claude Sonnet" (the version left off), or the slug when the provider no longer lists it. */
export function modelName(providers: ReadonlyArray<ServerProvider>, end: SwitchEnd): string {
  const provider = providerOf(providers, end);
  const model = provider === undefined ? null : modelOf(provider, end.model);
  const name = model?.name ?? end.model;
  return name.replace(/\s+v?\d+(?:[.-]\d+)*$/i, "").trim() || name;
}

function brandOf(providers: ReadonlyArray<ServerProvider>, end: SwitchEnd): string {
  return brandForDriver(end.driver || String(providerOf(providers, end)?.driver ?? end.instanceId));
}

/** The provider's own top model (its default), which the line calls its "top helper". */
function isTopModel(providers: ReadonlyArray<ServerProvider>, end: SwitchEnd): boolean {
  const provider = providerOf(providers, end);
  return provider !== undefined && modelOf(provider, end.model)?.isDefault === true;
}

/**
 * The line. Another company: "Claude is resting until Tuesday, so Sam is using ChatGPT for now."
 * The same company: "Claude's top helper is resting until Tuesday, so Sam is using Claude
 * Sonnet for now." Without a crew name, SKYCOT is the one using it.
 */
export function switchLine(input: {
  readonly change: Pick<AssistantSwitch, "from" | "to" | "until" | "crossProvider">;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly now: number;
  readonly timeZone: string;
  readonly crewName: string | null;
  readonly childView?: boolean;
}): string {
  const { change, providers } = input;
  if (input.childView) return "Sam took a short rest, so a helper stepped in.";
  const who = input.crewName ?? "SKYCOT";
  const until = restingUntilPhrase(change.until, input.now, input.timeZone);
  const resting = `is resting${until ? ` ${until}` : ""}`;
  if (change.crossProvider) {
    return `${brandOf(providers, change.from)} ${resting}, so ${who} is using ${brandOf(providers, change.to)} for now.`;
  }
  const subject = isTopModel(providers, change.from)
    ? `${brandOf(providers, change.from)}'s top helper`
    : modelName(providers, change.from);
  return `${subject} ${resting}, so ${who} is using ${modelName(providers, change.to)} for now.`;
}

type ProjectionPart = Pick<OrchestrationV2ThreadProjection, "runs" | "turnItems" | "messages">;

/** Whether the engine carried this (stopped) run on with another model. */
export function wasCarriedOn(projection: Pick<ProjectionPart, "messages">, runId: string): boolean {
  const id = `${SWITCH_MESSAGE_PREFIX}${runId}`;
  return projection.messages.some((message) => String(message.id) === id);
}

/**
 * A continuation's switch read from the conversation itself, for when the engine's notes are
 * not to hand (an older engine, the request still on its way): the stopped run's model and
 * reset time, and the model the continuation ran on.
 */
export function continuationSwitch(
  projection: ProjectionPart,
  providers: ReadonlyArray<ServerProvider>,
  messageId: string,
): AssistantSwitch | null {
  if (!messageId.startsWith(SWITCH_MESSAGE_PREFIX)) return null;
  const stoppedId = messageId.slice(SWITCH_MESSAGE_PREFIX.length);
  const stopped = projection.runs.find((run) => String(run.id) === stoppedId);
  const next = projection.runs.find((run) => String(run.userMessageId) === messageId);
  if (stopped === undefined || next === undefined) return null;
  const end = (selection: (typeof stopped)["modelSelection"]): SwitchEnd => {
    const instanceId = String(selection.instanceId);
    const provider = providers.find((candidate) => String(candidate.instanceId) === instanceId);
    return { instanceId, driver: String(provider?.driver ?? ""), model: selection.model };
  };
  let resetAt: string | null = null;
  for (const item of projection.turnItems) {
    if (item.type === "error" && String(item.runId) === stoppedId && item.failure.resetAt) {
      resetAt = item.failure.resetAt;
    }
  }
  const until = resetAt === null ? Number.NaN : Date.parse(resetAt);
  return {
    messageId,
    from: end(stopped.modelSelection),
    to: end(next.modelSelection),
    until: Number.isFinite(until) ? until : null,
    crossProvider:
      String(stopped.modelSelection.instanceId) !== String(next.modelSelection.instanceId),
    continuationOf: stoppedId,
  };
}

/** A stopped run's "limit reached" items, which the plain line replaces once it was carried on. */
export function isCarriedOnLimitItem(
  projection: Pick<ProjectionPart, "messages">,
  item: OrchestrationV2ThreadProjection["turnItems"][number],
): boolean {
  if (item.runId === null || !wasCarriedOn(projection, String(item.runId))) return false;
  if (item.type === "error") return item.failure.class === "usage_limit";
  return (
    item.type === "system_notice" && /usage limit|rate limit|limit reached/i.test(item.message)
  );
}

/**
 * What the grown-ups read (Settings › Family, the recap, the phone's Today) when a child's turn
 * moved to another company: "Claude was resting at 3:40 pm, so SKYCOT used ChatGPT instead."
 * Repeats of the same move are counted, not listed. `when` formats a time in the household's
 * zone.
 */
export function grownUpSwitchLines(
  entries: ReadonlyArray<{ readonly at: number; readonly from: string; readonly to: string }>,
  when: (at: number) => string,
): ReadonlyArray<string> {
  const groups = new Map<string, { at: number; from: string; to: string; count: number }>();
  for (const entry of entries) {
    const key = `${entry.from}\u0000${entry.to}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { ...entry, count: 1 });
    else group.count += 1;
  }
  return [...groups.values()].map((group) => {
    const from = brandForDriver(group.from);
    const to = brandForDriver(group.to);
    return group.count === 1
      ? `${from} was resting at ${when(group.at)}, so SKYCOT used ${to} instead.`
      : `${from} was resting, so SKYCOT used ${to} instead ${group.count} times.`;
  });
}
