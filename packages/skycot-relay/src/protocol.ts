// What travels between the relay and its two kinds of peers. The relay sees only this layer:
// which device socket a frame belongs to, and an opaque sealed payload (noise.ts) it cannot open.
//
//   Mac  ⇄ relay   one WebSocket per home: `/v1/homes/<homeId>/host`
//   device ⇄ relay one WebSocket per device connection: `/v1/homes/<homeId>/device`
//
// Text messages are small JSON control messages (challenge, hello, status, push). Binary
// messages carry sealed bytes: on the device socket as they are, on the host socket behind a
// 9-byte header naming the device connection.

export const RELAY_PROTOCOL_VERSION = 1;

/** The Noise prologue: binds every handshake to this protocol and this one home. */
export const prologueFor = (homeId: string) => new TextEncoder().encode(`skycot-relay/1|${homeId}`);

export const hostPath = (homeId: string) => `/v1/homes/${homeId}/host`;
export const devicePath = (homeId: string) => `/v1/homes/${homeId}/device`;

/** No relay frame is bigger than one Noise message plus its header. */
export const MAX_FRAME_BYTES = 65535 + 64;
export const MAX_CONTROL_BYTES = 8 * 1024;

export const CloseCode = {
  normal: 1000,
  unauthorized: 4001,
  revoked: 4003,
  notFound: 4004,
  rateLimited: 4008,
  replaced: 4009,
  tooBig: 4010,
  full: 4011,
  protocol: 4012,
  macGone: 4013,
} as const;

export const HostFrameKind = {
  /** relay → Mac: a device connection was admitted (payload: JSON `{ d }`). */
  open: 1,
  /** both ways: sealed bytes for or from one device connection. */
  data: 2,
  /** both ways: that device connection is over (payload: JSON `{ reason }`). */
  close: 3,
} as const;
export type HostFrameKind = (typeof HostFrameKind)[keyof typeof HostFrameKind];

/** 8 random bytes the relay gives each device connection, as 16 hex characters. */
export const CONNECTION_ID_BYTES = 8;

export interface HostFrame {
  readonly kind: HostFrameKind;
  readonly connectionId: string;
  readonly payload: Uint8Array;
}

export function encodeHostFrame(frame: HostFrame): Uint8Array {
  const out = new Uint8Array(1 + CONNECTION_ID_BYTES + frame.payload.length);
  out[0] = frame.kind;
  for (let index = 0; index < CONNECTION_ID_BYTES; index += 1) {
    out[1 + index] = Number.parseInt(frame.connectionId.slice(index * 2, index * 2 + 2), 16);
  }
  out.set(frame.payload, 1 + CONNECTION_ID_BYTES);
  return out;
}

export function decodeHostFrame(bytes: Uint8Array): HostFrame | null {
  if (bytes.length < 1 + CONNECTION_ID_BYTES) return null;
  const kind = bytes[0];
  if (kind !== HostFrameKind.open && kind !== HostFrameKind.data && kind !== HostFrameKind.close) {
    return null;
  }
  let connectionId = "";
  for (let index = 0; index < CONNECTION_ID_BYTES; index += 1) {
    connectionId += bytes[1 + index]!.toString(16).padStart(2, "0");
  }
  return { kind, connectionId, payload: bytes.subarray(1 + CONNECTION_ID_BYTES) };
}

export const CONNECTION_ID_PATTERN = /^[0-9a-f]{16}$/;

/** Notification kinds the Mac may ask for. The words live on the relay, never in the request. */
export const PUSH_KINDS = [
  "needs-grown-up",
  "finished",
  // A child's family note ("Show a grown-up", "more time") and the evening recap: plain words,
  // no Allow buttons.
  "family-note",
  "recap",
  "activity-update",
  "activity-end",
] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
export const isPushKind = (value: unknown): value is PushKind =>
  typeof value === "string" && (PUSH_KINDS as ReadonlyArray<string>).includes(value);

/** What a push token is for: an ordinary notification, or a Live Activity (Phase 3). */
export type PushTokenType = "alert" | "liveactivity";
export type ApnsEnvironment = "production" | "development";

/** Control messages, as JSON text frames. */
export type RelayToHost =
  | { readonly t: "challenge"; readonly nonce: string }
  | { readonly t: "ready" }
  | {
      readonly t: "push-result";
      readonly id: string;
      readonly ok: boolean;
      readonly reason?: string;
    }
  | { readonly t: "error"; readonly message: string };

export type HostToRelay =
  | { readonly t: "hello"; readonly publicKey: string; readonly signature: string }
  | {
      readonly t: "push";
      readonly id: string;
      readonly ref: string;
      readonly kind: PushKind;
      /** Optional bytes sealed for the device's app only (Phase 3); the relay cannot read them. */
      readonly sealed?: string;
    }
  | { readonly t: "revoke"; readonly deviceRelayId: string; readonly until: number };

export type RelayToDevice =
  | { readonly t: "status"; readonly mac: boolean }
  | { readonly t: "push-ref"; readonly id: string; readonly ref: string }
  | { readonly t: "error"; readonly message: string };

export type DeviceToRelay =
  | { readonly t: "hello"; readonly pass: string; readonly hostKey: string }
  | {
      readonly t: "push-register";
      readonly id: string;
      readonly token: string;
      readonly type: PushTokenType;
      readonly environment: ApnsEnvironment;
    };
