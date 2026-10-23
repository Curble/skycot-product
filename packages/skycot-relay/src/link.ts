// The link in the Phase 1 QR code, extended for the relay. Everything after `#` stays on the
// device (browsers never send a fragment to a server), so neither the relay nor whatever web
// server hosts the page sees the one-time code or the pass:
//
//   …/simple/#token=<one-time code>&relay=<relay address>&hk=<Mac signing key>
//             &nk=<Mac tunnel key>&d=<device relay id>&p=<relay pass>
//
// `hk` names the home (homeIdFor) and lets the relay check the pass; `nk` is the key the device
// seals its first message to, so a relay that swapped keys could not read anything: the device
// only ever talks to the key the Mac showed it on its own screen.

import { fromBase64Url } from "./encoding.ts";
import { DEVICE_RELAY_ID_PATTERN, homeIdFor, readPass } from "./pass.ts";

export interface RelayLinkParts {
  readonly relayUrl: string;
  readonly hostSigningKey: string;
  readonly hostNoiseKey: string;
  readonly deviceRelayId: string;
  readonly pass: string;
}

export interface RelayLink extends RelayLinkParts {
  readonly homeId: string;
  /** The one-time pairing code, when the link still carries one. */
  readonly token: string | null;
}

/** Only https, or http to this machine for local testing. */
export function isAllowedRelayUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.pathname !== "/" && url.pathname !== "") return false;
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
  );
}

export const normaliseRelayUrl = (value: string) => new URL(value).origin;

export function relayLinkParams(parts: RelayLinkParts): Array<[string, string]> {
  return [
    ["relay", parts.relayUrl],
    ["hk", parts.hostSigningKey],
    ["nk", parts.hostNoiseKey],
    ["d", parts.deviceRelayId],
    ["p", parts.pass],
  ];
}

const key32 = (value: string | null) => {
  if (value === null) return null;
  const bytes = fromBase64Url(value);
  return bytes !== null && bytes.length === 32 ? bytes : null;
};

/** Reads a link's fragment (with or without the `#`); `null` when it has no relay part. */
export function parseRelayLink(fragment: string): RelayLink | null {
  const params = new URLSearchParams(fragment.replace(/^#/, "").replace(/^\/?\?/, ""));
  const relayUrl = params.get("relay");
  const hostSigningKey = params.get("hk");
  const hostNoiseKey = params.get("nk");
  const deviceRelayId = params.get("d");
  const pass = params.get("p");
  if (relayUrl === null || !isAllowedRelayUrl(relayUrl)) return null;
  const signing = key32(hostSigningKey);
  if (signing === null || key32(hostNoiseKey) === null) return null;
  if (deviceRelayId === null || !DEVICE_RELAY_ID_PATTERN.test(deviceRelayId)) return null;
  if (pass === null) return null;
  const homeId = homeIdFor(signing);
  const readable = readPass(pass);
  if (readable === null || readable.homeId !== homeId || readable.deviceRelayId !== deviceRelayId) {
    return null;
  }
  return {
    relayUrl: normaliseRelayUrl(relayUrl),
    hostSigningKey: hostSigningKey!,
    hostNoiseKey: hostNoiseKey!,
    deviceRelayId,
    pass,
    homeId,
    token: params.get("token"),
  };
}
