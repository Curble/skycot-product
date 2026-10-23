// Who may use a home on the relay, decided without any account or database.
//
// A home is named after the Mac's own signing key (Ed25519): `homeId` is a hash of the public
// key, so only the Mac that holds the private key can answer the relay's challenge for it, and
// nobody can pick a home name that belongs to someone else.
//
// A device gets a **relay pass** from its Mac: a short statement "device d may reach home h until
// exp", signed with the same key. The relay checks the signature with the public key (which the
// device sends and which must hash to the home's name), so it needs to remember nothing. A pass
// only gets a device as far as the Mac's door: the Mac still checks the device's own Noise key
// and its T3 sign-in on every request. A pass is never a sign-in.

import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";

import {
  concatBytes,
  fromBase64Url,
  fromUtf8,
  parseJsonObject,
  randomBytes,
  toBase32,
  toBase64Url,
  utf8,
} from "./encoding.ts";

export interface SigningKeyPair {
  readonly publicKey: Uint8Array;
  readonly secretKey: Uint8Array;
}

export function generateSigningKeyPair(): SigningKeyPair {
  const secretKey = ed25519.utils.randomPrivateKey();
  return { secretKey, publicKey: ed25519.getPublicKey(secretKey) };
}

export function signingKeyPairFromSecret(secretKey: Uint8Array): SigningKeyPair {
  return { secretKey, publicKey: ed25519.getPublicKey(secretKey) };
}

const HOME_ID_DOMAIN = utf8("skycot-relay/home-id/v1");

/** 32 lower-case base32 characters (160 bits of the hash): unguessable and URL-safe. */
export function homeIdFor(hostSigningPublicKey: Uint8Array): string {
  return toBase32(sha256(concatBytes(HOME_ID_DOMAIN, hostSigningPublicKey)).subarray(0, 20));
}

export const HOME_ID_PATTERN = /^[a-z2-7]{32}$/;
export const DEVICE_RELAY_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** A random id for one device on the relay; unrelated to its id in the Family profile. */
export function newDeviceRelayId(): string {
  return toBase64Url(randomBytes(16));
}

function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

const hostChallengeMessage = (homeId: string, nonce: string) =>
  utf8(`skycot-relay/host-hello/v1|${homeId}|${nonce}`);

/** The Mac's answer to the relay's challenge when it connects as a home's host. */
export function signHostChallenge(key: SigningKeyPair, homeId: string, nonce: string): string {
  return toBase64Url(ed25519.sign(hostChallengeMessage(homeId, nonce), key.secretKey));
}

export function verifyHostChallenge(input: {
  readonly homeId: string;
  readonly nonce: string;
  readonly publicKey: string;
  readonly signature: string;
}): boolean {
  const publicKey = fromBase64Url(input.publicKey);
  const signature = fromBase64Url(input.signature);
  if (publicKey === null || signature === null || publicKey.length !== 32) return false;
  if (homeIdFor(publicKey) !== input.homeId) return false;
  return verify(signature, hostChallengeMessage(input.homeId, input.nonce), publicKey);
}

export interface RelayPass {
  readonly homeId: string;
  readonly deviceRelayId: string;
  /** Seconds since 1970. */
  readonly expiresAt: number;
}

const PASS_PREFIX = "skycot-relay/pass/v1.";

export function signPass(key: SigningKeyPair, pass: RelayPass): string {
  const body = toBase64Url(
    utf8(JSON.stringify({ h: pass.homeId, d: pass.deviceRelayId, exp: pass.expiresAt })),
  );
  const signature = ed25519.sign(utf8(`${PASS_PREFIX}${body}`), key.secretKey);
  return `${body}.${toBase64Url(signature)}`;
}

/** Reads a pass without checking it (the device, to know when to renew). */
export function readPass(token: string): RelayPass | null {
  const [body] = token.split(".");
  const bytes = body === undefined ? null : fromBase64Url(body);
  if (bytes === null) return null;
  let parsed: Record<string, unknown> | null;
  try {
    parsed = parseJsonObject(fromUtf8(bytes));
  } catch {
    return null;
  }
  if (parsed === null) return null;
  const { h, d, exp } = parsed;
  if (typeof h !== "string" || !HOME_ID_PATTERN.test(h)) return null;
  if (typeof d !== "string" || !DEVICE_RELAY_ID_PATTERN.test(d)) return null;
  if (typeof exp !== "number" || !Number.isSafeInteger(exp)) return null;
  return { homeId: h, deviceRelayId: d, expiresAt: exp };
}

/** The relay's check: signed by the home's own key, for this home, not expired. */
export function verifyPass(input: {
  readonly token: string;
  readonly homeId: string;
  readonly hostPublicKey: string;
  readonly nowSeconds: number;
}): RelayPass | null {
  if (input.token.length > 512) return null;
  const parts = input.token.split(".");
  if (parts.length !== 2) return null;
  const [body, signatureText] = parts as [string, string];
  const publicKey = fromBase64Url(input.hostPublicKey);
  const signature = fromBase64Url(signatureText);
  if (publicKey === null || signature === null || publicKey.length !== 32) return null;
  if (homeIdFor(publicKey) !== input.homeId) return null;
  if (!verify(signature, utf8(`${PASS_PREFIX}${body}`), publicKey)) return null;
  const pass = readPass(input.token);
  if (pass === null || pass.homeId !== input.homeId) return null;
  if (pass.expiresAt <= input.nowSeconds) return null;
  return pass;
}
