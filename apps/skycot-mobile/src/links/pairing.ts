/**
 * Linking this device to a family's Mac, with Phase 1's pairing (docs/nondev/WHO-IS-WHO.md).
 *
 * The Mac's Settings › Family › Phones and iPads › Link… shows a QR code (the link
 * `http://<mac>/simple/#token=<code>`), the same twelve-letter code to type, and the address.
 * Either way this device swaps the one-use code for its own sign-in at `/oauth/token`, exactly
 * as T3's own app does (client-runtime's bootstrapRemoteBearerSession), and then asks the Mac
 * who it is: a child's device or a grown-up's phone. The Mac decided that when it made the link;
 * nothing here can change it.
 */
import { groupLinkCode, normaliseLinkCode } from "@t3tools/skycot-rules/people";

import type { HomeRecord } from "@t3tools/skycot-relay/client/home";
import { parseRelayLink, type RelayLink } from "@t3tools/skycot-relay/link";

import { parseMe, type FamilyMe } from "../../../nondev/src/features/family/people";
import { directTransport, type MacTransport } from "../transport/MacTransport";

// nondev-seam: skycot-mobile-link-failure-copy

/** T3's pairing alphabet: no 0, 1, I or O, so a typed code can't be misread. */
const CODE_PATTERN = /^[2-9A-HJ-NP-Z]{12}$/u;

export type LinkInput =
  | { readonly kind: "scanned"; readonly text: string }
  | { readonly kind: "typed"; readonly code: string; readonly address: string };

export interface LinkTarget {
  /** The Mac's own address; null when the link only names SKYCOT Relay's. */
  readonly httpBaseUrl: string | null;
  readonly code: string;
  /** SKYCOT Relay's part of a scanned link, when the Mac reaches beyond home (RELAY.md). */
  readonly relay: RelayLink | null;
}

export type LinkProblem =
  | "not-a-skycot-code"
  | "code-shape"
  | "address-missing"
  | "address-shape"
  | "unreachable"
  | "code-used"
  | "not-linked"
  | "not-a-family-device"
  | "wrong-kind";

export class LinkError extends Error {
  override readonly name = "LinkError";
  constructor(
    readonly problem: LinkProblem,
    message: string,
  ) {
    super(message);
  }
}

export const LINK_COPY: Readonly<Record<LinkProblem, string>> = {
  "not-a-skycot-code":
    "That isn't a SKYCOT code. On the Mac, open Settings › Family › Phones and iPads › Link… and scan the code there.",
  "code-shape":
    "The code is twelve letters and numbers, like 7KQ3 M9XD 2HPA. Check it and try again.",
  "address-missing": "Type the Mac's address too. It's shown under the code on the Mac.",
  "address-shape":
    "That address doesn't look right. It's shown under the code on the Mac, like 192.168.1.20:3773.",
  unreachable:
    "This device can't reach the Mac. Check they're on the same Wi-Fi (or both on Tailscale) and the Mac is awake.",
  "code-used":
    "That code has been used or has run out (each one works once, for five minutes). Make a new one on the Mac.",
  "not-linked": "The Mac didn't link this device. Make a new code on the Mac and try again.",
  "not-a-family-device":
    "That code links a whole Mac, not a family member's device. On the Mac, use Settings › Family › Phones and iPads › Link… instead.",
  "wrong-kind":
    "This device is already linked as someone else's kind of device. A child's iPad can't also be a grown-up's phone.",
};

export type LinkFailureKind = "first-connection" | "later-connection";

/** Copy depends on what the QR offered and whether the first contact reached the Mac. */
export function linkFailureCopy(target: LinkTarget, failure: LinkFailureKind): string {
  const homeAddress = target.httpBaseUrl;
  const loopback =
    homeAddress !== null && /^(localhost|127\..*|\[?::1\]?)$/u.test(new URL(homeAddress).hostname);
  if ((homeAddress === null || loopback) && target.relay === null) {
    return "This Mac isn't set up for phones yet. On the Mac: Settings › Family › Away from home › turn on Reach this Mac from anywhere, then make a new QR code.";
  }
  if (failure === "first-connection" && homeAddress !== null && target.relay === null) {
    return "Turn on Local Network access for SKYCOT in iPhone Settings, then scan the Mac's code again.";
  }
  return "Wake the Mac and try again while your iPhone and Mac are on the same Wi-Fi.";
}

/** "192.168.1.20:3773" or a full address → "http://192.168.1.20:3773". */
export function normaliseAddress(address: string): string | null {
  const trimmed = address.trim().replace(/\/+$/u, "");
  if (trimmed.length === 0) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname.length === 0) return null;
  return `${url.protocol}//${url.host}`;
}

/** Reads what the camera saw, or what was typed, into an address and a code. */
export function readLinkInput(input: LinkInput): LinkTarget {
  if (input.kind === "scanned") {
    let url: URL;
    try {
      url = new URL(input.text.trim());
    } catch {
      throw new LinkError("not-a-skycot-code", LINK_COPY["not-a-skycot-code"]);
    }
    const fromHash = new URLSearchParams(url.hash.replace(/^#/u, "")).get("token");
    const raw = fromHash ?? url.searchParams.get("token");
    const code = raw === null ? "" : normaliseLinkCode(raw);
    const base = normaliseAddress(`${url.protocol}//${url.host}`);
    if (!CODE_PATTERN.test(code) || base === null) {
      throw new LinkError("not-a-skycot-code", LINK_COPY["not-a-skycot-code"]);
    }
    const relay = parseRelayLink(url.hash);
    // A link that opens through the relay is served from the relay's address, not the Mac's.
    const ownAddress = relay !== null && relay.relayUrl === base ? null : base;
    return { httpBaseUrl: ownAddress, code, relay };
  }
  const code = normaliseLinkCode(input.code);
  if (!CODE_PATTERN.test(code)) throw new LinkError("code-shape", LINK_COPY["code-shape"]);
  if (input.address.trim().length === 0) {
    throw new LinkError("address-missing", LINK_COPY["address-missing"]);
  }
  const base = normaliseAddress(input.address);
  if (base === null) throw new LinkError("address-shape", LINK_COPY["address-shape"]);
  return { httpBaseUrl: base, code, relay: null };
}

export { groupLinkCode };

/** One linked Mac, as this device keeps it. The sign-in itself lives in the keychain. */
export interface MacLink {
  /** The Mac engine's own id (`/.well-known/t3/environment`). */
  readonly macId: string;
  /** "MamaBear": the Mac's name, shown beside its conversations. */
  readonly macName: string;
  /** The Mac's own address on the home Wi-Fi or Tailscale; null when it's reached by relay only. */
  readonly httpBaseUrl: string | null;
  readonly me: Extract<FamilyMe, { kind: "child" | "grown-up" }>;
  readonly linkedAt: number;
}

export interface LinkedMac extends MacLink {
  readonly bearerToken: string;
  /** This device's tunnel keys and pass for the Mac, when it can be reached through the relay. */
  readonly relayRecord: HomeRecord | null;
}

/** The ways to one Mac for a sign-in (null while linking): see src/links/store.tsx. */
export type WaysToMac = (bearerToken: string | null) => MacTransport;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Swaps the one-use code for this device's own sign-in, then asks the Mac who it is. */
export async function linkToMac(
  target: LinkTarget,
  options: {
    readonly fetch?: typeof fetch;
    readonly deviceLabel?: string;
    readonly deviceType?: "mobile" | "tablet";
    /** How to reach the Mac; the Mac's own address when not given. */
    readonly ways?: WaysToMac;
    readonly relayRecord?: HomeRecord | null;
  } = {},
): Promise<LinkedMac> {
  const ways: WaysToMac =
    options.ways ??
    ((bearerToken) => {
      if (target.httpBaseUrl === null) throw new LinkError("unreachable", LINK_COPY.unreachable);
      return directTransport(
        { httpBaseUrl: target.httpBaseUrl, bearerToken },
        options.fetch ? { fetch: options.fetch } : {},
      );
    });
  const firstFailure = () =>
    new LinkError("unreachable", linkFailureCopy(target, "first-connection"));
  let open: MacTransport;
  try {
    open = ways(null);
  } catch {
    throw firstFailure();
  }
  const call = async (
    run: (transport: MacTransport) => ReturnType<MacTransport["request"]>,
    first = false,
  ) => {
    try {
      return await run(open);
    } catch {
      throw first ? firstFailure() : new LinkError("unreachable", LINK_COPY.unreachable);
    }
  };
  const descriptor = await call(
    (transport) =>
      transport.request({ method: "GET", path: "/.well-known/t3/environment", signedIn: false }),
    true,
  );
  const described = record(descriptor.json);
  const macId = typeof described.environmentId === "string" ? described.environmentId : null;
  if (descriptor.status !== 200 || macId === null) {
    throw new LinkError("unreachable", LINK_COPY.unreachable);
  }
  const macName =
    typeof described.label === "string" && described.label.trim().length > 0
      ? described.label.trim()
      : "The family's Mac";

  const exchanged = await call((transport) =>
    transport.request({
      method: "POST",
      path: "/oauth/token",
      signedIn: false,
      form: {
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: target.code,
        subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        client_label: options.deviceLabel ?? "SKYCOT app",
        client_device_type: options.deviceType ?? "mobile",
        client_os: "ios",
      },
    }),
  );
  const token = record(exchanged.json).access_token;
  if (exchanged.status === 401 || exchanged.status === 400) {
    throw new LinkError("code-used", LINK_COPY["code-used"]);
  }
  if (exchanged.status !== 200 || typeof token !== "string") {
    throw new LinkError("not-linked", LINK_COPY["not-linked"]);
  }

  const signedIn = ways(token);
  const status = await call(() => signedIn.request({ method: "GET", path: "/api/skycot/family" }));
  const me = parseMe(record(status.json).me);
  if (me.kind === "shared") {
    throw new LinkError("not-a-family-device", LINK_COPY["not-a-family-device"]);
  }
  return {
    macId,
    macName,
    httpBaseUrl: target.httpBaseUrl,
    me,
    linkedAt: Date.now(),
    bearerToken: token,
    relayRecord: options.relayRecord ?? null,
  };
}

/** The mode this device runs in, from its links (one kind for every link). */
export type DeviceMode = "unlinked" | "child" | "grown-up";

export function modeOf(links: ReadonlyArray<MacLink>): DeviceMode {
  const first = links[0];
  return first === undefined ? "unlinked" : first.me.kind;
}

/** A second Mac must agree with the first about what this device is. */
export function acceptsLink(links: ReadonlyArray<MacLink>, next: MacLink): boolean {
  const mode = modeOf(links);
  return mode === "unlinked" || mode === next.me.kind;
}
