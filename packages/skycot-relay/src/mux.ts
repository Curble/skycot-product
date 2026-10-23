// Inside the sealed channel: T3's own HTTP and WebSocket API, carried as small frames so one
// channel holds many requests and sockets at once. Only the device and the Mac ever see these.
//
//   [type u8][stream u32][flags u8][body]
//
// HTTP bodies and WebSocket messages are cut into pieces of at most `MAX_CHUNK` bytes so every
// frame fits one Noise message; the FIN flag marks the last piece.

import { concatBytes, fromUtf8, parseJsonObject, readU32, utf8, writeU32 } from "./encoding.ts";
import { MAX_PLAINTEXT_LENGTH } from "./noise.ts";

export const MuxType = {
  requestHead: 0x01,
  requestBody: 0x02,
  responseHead: 0x03,
  responseBody: 0x04,
  responseError: 0x05,
  socketOpen: 0x06,
  socketAccept: 0x07,
  socketData: 0x08,
  socketClose: 0x09,
  cancel: 0x0a,
  /** A small JSON request to the Mac's tunnel itself (renew the pass, a push reference). */
  control: 0x0b,
  controlReply: 0x0c,
} as const;
export type MuxType = (typeof MuxType)[keyof typeof MuxType];

export const MuxFlag = {
  fin: 0b01,
  binary: 0b10,
} as const;

const HEADER_BYTES = 6;
export const MAX_CHUNK = MAX_PLAINTEXT_LENGTH - HEADER_BYTES;

export interface MuxFrame {
  readonly type: MuxType;
  readonly stream: number;
  readonly flags: number;
  readonly body: Uint8Array;
}

const TYPES = new Set<number>(Object.values(MuxType));

export function encodeMux(frame: MuxFrame): Uint8Array {
  if (frame.body.length > MAX_CHUNK) throw new Error("A tunnel frame is too long.");
  const header = new Uint8Array(HEADER_BYTES);
  header[0] = frame.type;
  writeU32(header, 1, frame.stream);
  header[5] = frame.flags;
  return concatBytes(header, frame.body);
}

export function decodeMux(bytes: Uint8Array): MuxFrame | null {
  if (bytes.length < HEADER_BYTES) return null;
  const type = bytes[0]!;
  if (!TYPES.has(type)) return null;
  return {
    type: type as MuxType,
    stream: readU32(bytes, 1),
    flags: bytes[5]!,
    body: bytes.subarray(HEADER_BYTES),
  };
}

export const jsonFrame = (type: MuxType, stream: number, value: unknown, flags = 0): MuxFrame => ({
  type,
  stream,
  flags,
  body: utf8(JSON.stringify(value)),
});

export function frameJson(frame: MuxFrame): Record<string, unknown> | null {
  try {
    return parseJsonObject(fromUtf8(frame.body));
  } catch {
    return null;
  }
}

/** Cuts bytes into body frames; an empty body is one empty FIN frame. */
export function* chunkFrames(
  type: MuxType,
  stream: number,
  bytes: Uint8Array,
  extraFlags = 0,
): Generator<MuxFrame> {
  if (bytes.length === 0) {
    yield { type, stream, flags: MuxFlag.fin | extraFlags, body: bytes };
    return;
  }
  for (let offset = 0; offset < bytes.length; offset += MAX_CHUNK) {
    const end = Math.min(bytes.length, offset + MAX_CHUNK);
    yield {
      type,
      stream,
      flags: (end === bytes.length ? MuxFlag.fin : 0) | extraFlags,
      body: bytes.subarray(offset, end),
    };
  }
}

/** Header lists as pairs, so repeated headers (Set-Cookie) survive. */
export type HeaderPairs = ReadonlyArray<readonly [string, string]>;

export interface RequestHead {
  readonly method: string;
  /** Path and query, e.g. `/api/auth/session`; never a full URL. */
  readonly path: string;
  readonly headers: HeaderPairs;
}

export interface ResponseHead {
  readonly status: number;
  readonly headers: HeaderPairs;
}

export interface SocketOpen {
  readonly path: string;
  readonly protocols: ReadonlyArray<string>;
  readonly headers: HeaderPairs;
}

export function readHeaderPairs(value: unknown): HeaderPairs | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const pairs: Array<readonly [string, string]> = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [name, headerValue] = entry as [unknown, unknown];
    if (typeof name !== "string" || typeof headerValue !== "string") return null;
    pairs.push([name.toLowerCase(), headerValue]);
  }
  return pairs;
}

/** A path the tunnel will carry: absolute, no scheme or host, no dot segments. */
export function isTunnelPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.length > 8192) return false;
  if (/[\s\\]/.test(path)) return false;
  const pathname = path.split("?")[0]!;
  return !pathname.split("/").some((segment) => segment === ".." || segment === ".");
}

export function readRequestHead(frame: MuxFrame): RequestHead | null {
  const value = frameJson(frame);
  if (value === null) return null;
  const headers = readHeaderPairs(value["headers"]);
  const { method, path } = value;
  if (typeof method !== "string" || !/^[A-Z]{3,7}$/.test(method)) return null;
  if (typeof path !== "string" || !isTunnelPath(path) || headers === null) return null;
  return { method, path, headers };
}

export function readResponseHead(frame: MuxFrame): ResponseHead | null {
  const value = frameJson(frame);
  if (value === null) return null;
  const headers = readHeaderPairs(value["headers"]);
  const { status } = value;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) {
    return null;
  }
  return headers === null ? null : { status, headers };
}

export function readSocketOpen(frame: MuxFrame): SocketOpen | null {
  const value = frameJson(frame);
  if (value === null) return null;
  const headers = readHeaderPairs(value["headers"]);
  const { path, protocols } = value;
  if (typeof path !== "string" || !isTunnelPath(path) || headers === null) return null;
  if (!Array.isArray(protocols) || !protocols.every((entry) => typeof entry === "string")) {
    return null;
  }
  return { path, protocols: protocols as Array<string>, headers };
}

/** The first message's payload, from the device: who it is on the relay and when it spoke. */
export interface DeviceHello {
  readonly version: 1;
  readonly deviceRelayId: string;
  /** Milliseconds since 1970, strictly greater than the last one this key sent. */
  readonly timestamp: number;
}

export const encodeDeviceHello = (hello: Omit<DeviceHello, "version">) =>
  utf8(JSON.stringify({ v: 1, d: hello.deviceRelayId, ts: hello.timestamp }));

export function decodeDeviceHello(bytes: Uint8Array): DeviceHello | null {
  let value: Record<string, unknown> | null;
  try {
    value = parseJsonObject(fromUtf8(bytes));
  } catch {
    return null;
  }
  if (value === null || value["v"] !== 1) return null;
  const { d, ts } = value;
  if (typeof d !== "string" || typeof ts !== "number" || !Number.isSafeInteger(ts)) return null;
  return { version: 1, deviceRelayId: d, timestamp: ts };
}
