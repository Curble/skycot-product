/**
 * Which linked Macs still need this device's push token, and which waiting request a pushed
 * "SKYCOT needs a grown-up" notification's Decline means. Pure, so it is tested without iOS.
 *
 * A token goes to a Mac through SKYCOT Relay only (RelayHome.registerPush): the relay seals it
 * into a reference only it can open and the Mac keeps that reference for this device. Each
 * registration makes a new reference (the Mac keeps the newest two), so a token is handed over
 * once per Mac link and again only when iOS gives a new token or the device is linked again.
 */
import type { PushToken } from "../../modules/skycot-watch";

/** One linked Mac this device reaches through SKYCOT Relay. */
export interface PushHome {
  readonly macId: string;
  readonly homeId: string;
  /** Changes when the device is linked again, so the new link gets the token too. */
  readonly deviceRelayId: string;
}

export const registrationKey = (home: PushHome, token: PushToken): string =>
  `${home.homeId}|${home.deviceRelayId}|${token.environment}|${token.token}`;

/** What was handed over before, as kept on this device; anything unreadable counts as nothing. */
export function parseRegistered(raw: string | null): ReadonlySet<string> {
  if (raw === null) return new Set();
  try {
    const value = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : []);
  } catch {
    return new Set();
  }
}

/** The Macs that have not had this token through this link yet. */
export function homesToRegister<Home extends PushHome>(
  homes: ReadonlyArray<Home>,
  token: PushToken,
  registered: ReadonlySet<string>,
): ReadonlyArray<Home> {
  return homes.filter((home) => !registered.has(registrationKey(home, token)));
}

/** What to keep remembering: only this token, only for Macs still linked. */
export function stillRegistered(
  homes: ReadonlyArray<PushHome>,
  token: PushToken,
  registered: ReadonlySet<string>,
): Set<string> {
  const current = new Set(homes.map((home) => registrationKey(home, token)));
  return new Set([...registered].filter((key) => current.has(key)));
}

export interface WaitingRequest {
  readonly macId: string;
  readonly threadId: string;
  readonly requestId: string;
  readonly fingerprint: string;
  readonly lapsed: boolean;
}

/**
 * A pushed notification names no request (the relay never learns one). Its Decline declines a
 * request only when exactly one is waiting on every linked Mac together; with several, the
 * grown-up chooses which (each gets its own notification), and with none there is nothing to do.
 * A yes is never taken from a notification: Allow once opens the card, as before.
 */
export function pushedDeclineTarget(waiting: ReadonlyArray<WaitingRequest>): WaitingRequest | null {
  const live = waiting.filter((request) => !request.lapsed);
  return live.length === 1 ? live[0]! : null;
}
