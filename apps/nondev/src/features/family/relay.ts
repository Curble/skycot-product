// SKYCOT Relay as the Mac's Family settings show it: the engine's status (GET
// /api/skycot/family/relay) and the plain words for each state. Pure, so the words are tested.

import type { StepBadgeState } from "../../ui/StepBadge";

export type RelayState =
  | "not-available"
  | "off"
  | "connecting"
  | "connected"
  | "unreachable"
  | "refused";

export interface RelayStatus {
  readonly available: boolean;
  readonly enabled: boolean;
  readonly state: RelayState;
  readonly relayHost: string | null;
  readonly devicesLinked: number;
  readonly devicesOnline: number;
}

const STATES: ReadonlySet<string> = new Set([
  "not-available",
  "off",
  "connecting",
  "connected",
  "unreachable",
  "refused",
]);

export function parseRelayStatus(body: unknown): RelayStatus | null {
  if (typeof body !== "object" || body === null) return null;
  const input = body as Record<string, unknown>;
  const state = input["state"];
  if (typeof state !== "string" || !STATES.has(state)) return null;
  const count = (value: unknown) =>
    typeof value === "number" && value >= 0 ? Math.floor(value) : 0;
  return {
    available: input["available"] === true,
    enabled: input["enabled"] === true,
    state: state as RelayState,
    relayHost: typeof input["relayHost"] === "string" ? input["relayHost"] : null,
    devicesLinked: count(input["devicesLinked"]),
    devicesOnline: count(input["devicesOnline"]),
  };
}

export const RELAY_TITLE = "Reach this Mac from your phone";

export const RELAY_FOOTER =
  "Phones and iPads you link here can reach this Mac through SKYCOT Relay, even off your home Wi-Fi. It is for the moment you step into the next room: SKYCOT is for using together, so stay close. Everything is sealed on your devices and on this Mac, so the relay passes it along without being able to read it. No accounts, and nothing is kept. Notifications only ever say “SKYCOT needs a grown-up” or “Sam has finished”.";

export interface RelaySummary {
  readonly subtitle: string;
  readonly badge: StepBadgeState;
  readonly switchOn: boolean;
  readonly switchDisabled: boolean;
}

const devicesPhrase = (count: number) =>
  count === 0
    ? "No device is connected through it right now."
    : count === 1
      ? "1 device is connected through it now."
      : `${count} devices are connected through it now.`;

export function relaySummary(status: RelayStatus | null): RelaySummary {
  if (status === null) {
    return { subtitle: "Checking…", badge: "todo", switchOn: false, switchDisabled: true };
  }
  switch (status.state) {
    case "not-available":
      return {
        subtitle:
          "Not in this version of SKYCOT yet. Linked phones and iPads work on your home network.",
        badge: "todo",
        switchOn: false,
        switchDisabled: true,
      };
    case "off":
      return {
        subtitle: "Off. Linked phones and iPads work only on your home network.",
        badge: "todo",
        switchOn: false,
        switchDisabled: false,
      };
    case "connecting":
      return {
        subtitle: "Connecting to SKYCOT Relay…",
        badge: "now",
        switchOn: true,
        switchDisabled: false,
      };
    case "connected":
      return {
        subtitle: `On. Linked phones and iPads can reach this Mac from the next room, or further. ${devicesPhrase(status.devicesOnline)}`,
        badge: "ok",
        switchOn: true,
        switchDisabled: false,
      };
    case "unreachable":
      return {
        subtitle:
          "On, but SKYCOT Relay can't be reached right now. This Mac keeps trying; at home everything still works.",
        badge: "warn",
        switchOn: true,
        switchDisabled: false,
      };
    case "refused":
      return {
        subtitle:
          "On, but SKYCOT Relay turned this Mac away. Turning it off and on again usually fixes it.",
        badge: "fail",
        switchOn: true,
        switchDisabled: false,
      };
  }
}

/** A phone needs either an address on the home network or an enabled relay in its link. */
export function linkNeedsRelayStep(
  status: RelayStatus | null,
  addresses: ReadonlyArray<{ readonly reachable: boolean }>,
): boolean {
  return status !== null && !status.enabled && !addresses.some((address) => address.reachable);
}

// nondev-seam: skycot-family-reachable-link
export function reachableLink<T extends { readonly reachable: boolean }>(
  links: ReadonlyArray<T>,
): T | null {
  return links.find((link) => link.reachable) ?? null;
}
