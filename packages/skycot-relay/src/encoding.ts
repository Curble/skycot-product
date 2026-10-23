// Byte helpers that behave the same in Workers, Node, browsers and React Native (Hermes has no
// Buffer, and older Hermes builds no atob/btoa), so the relay, the Mac and every device agree on
// every encoded byte.

import { randomBytes as nobleRandomBytes } from "@noble/hashes/utils";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const utf8 = (text: string): Uint8Array => encoder.encode(text);
export const fromUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes);

/** Cryptographically secure random bytes (crypto.getRandomValues underneath). */
export const randomBytes = (length: number): Uint8Array => nobleRandomBytes(length);

export function concatBytes(...parts: ReadonlyArray<Uint8Array>): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Constant-time comparison: how long it takes says nothing about where two keys differ. */
export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index]! ^ right[index]!;
  return diff === 0;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_LOOKUP = new Map([...B64].map((char, index) => [char, index]));

export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  let index = 0;
  for (; index + 2 < bytes.length; index += 3) {
    const n = (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = bytes.length - index;
  if (rest === 1) {
    const n = bytes[index]! << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[index]! << 16) | (bytes[index + 1]! << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]!;
  }
  return out;
}

/** Strict: anything that is not unpadded base64url (or would not round-trip) is `null`. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let offset = 0;
  for (const char of text) {
    const digit = B64_LOOKUP.get(char);
    if (digit === undefined) return null;
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[offset++] = (value >> bits) & 0xff;
    }
  }
  // Leftover bits must be zero, or two different strings would decode to the same bytes.
  if ((value & ((1 << bits) - 1)) !== 0) return null;
  return out;
}

const B32 = "abcdefghijklmnopqrstuvwxyz234567";

/** Lower-case RFC 4648 base32 without padding: safe in a URL path and in a DNS label. */
export function toBase32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32[(value >> bits) & 31]!;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]!;
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) >>> 0) +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}

export function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

/** JSON that came off the wire: an object, or `null` for anything else. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
