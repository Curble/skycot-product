// Passkeys (WebAuthn) for a grown-up's device: Face ID or Touch ID instead of typing the parent
// code. Pure verification: parsing the authenticator's answers is @oslojs/webauthn's job (MIT, a
// small, maintained parser by the author of Lucia), and checking the signature is Node's own
// crypto (OpenSSL). Nothing here is secret: the engine keeps only the public key.
//
// What is checked, every time:
// - the challenge is one the engine made for this device and this one action, still fresh, and
//   used only once (the caller keeps the challenge book, SkycotFamilyDevices);
// - the page's origin and the relying party (the address the device used) match what the
//   passkey was made for;
// - the authenticator saw the person (user present) and checked them (user verified: Face ID,
//   Touch ID or the device passcode);
// - for a yes, the signature over the authenticator data and the page's data, with the public
//   key registered for this device; and the counter moves forward when the authenticator keeps
//   one (a cloned key would repeat an old count).
//
// Attestation (which make of authenticator it is) is not checked: SKYCOT has no list of
// approved makers, and the parent code linking the device is what vouches for it.

// Hashing and signature checks have no Effect counterpart; these are pure calls.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import {
  ClientDataType,
  COSEKeyType,
  coseAlgorithmES256,
  coseAlgorithmRS256,
  coseEllipticCurveP256,
  createAssertionSignatureMessage,
  parseAttestationObject,
  parseAuthenticatorData,
  parseClientDataJSON,
} from "@oslojs/webauthn";

import type { FamilyPasskey } from "../SkycotFamily.ts";

export const SUPPORTED_ALGORITHMS = [coseAlgorithmES256, coseAlgorithmRS256] as const;

export type PasskeyFailure =
  | "malformed"
  | "wrong-type"
  | "wrong-challenge"
  | "wrong-origin"
  | "wrong-relying-party"
  | "not-verified"
  | "unsupported-key"
  | "unknown-key"
  | "bad-signature"
  | "replayed-counter";

export class PasskeyError extends Error {
  readonly reason: PasskeyFailure;
  constructor(reason: PasskeyFailure) {
    super(`Passkey check failed: ${reason}`);
    this.reason = reason;
  }
}

const fromBase64Url = (value: unknown): Uint8Array => {
  if (typeof value !== "string" || value.length === 0 || value.length > 16_384) {
    throw new PasskeyError("malformed");
  }
  return new Uint8Array(Buffer.from(value, "base64url"));
};

export const toBase64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

const bigintBytes = (value: bigint, length?: number): Buffer => {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  const raw = Buffer.from(hex, "hex");
  if (length === undefined || raw.length >= length) return raw;
  return Buffer.concat([Buffer.alloc(length - raw.length), raw]);
};

/**
 * The challenge for one action: a hash of what is being allowed (for a yes: the request, the
 * decision and a fingerprint of the card the phone showed) and a fresh random nonce. The
 * authenticator signs over it, so the yes is tied to exactly that action.
 */
export function makeChallenge(action: string, nonce: Uint8Array = NodeCrypto.randomBytes(32)) {
  return new Uint8Array(NodeCrypto.createHash("sha256").update(action).update(nonce).digest());
}

export interface ExpectedCeremony {
  readonly challenge: Uint8Array;
  readonly origin: string;
  readonly rpId: string;
}

function checkClientData(
  clientDataJSON: Uint8Array,
  type: ClientDataType,
  expected: ExpectedCeremony,
) {
  let clientData;
  try {
    clientData = parseClientDataJSON(clientDataJSON);
  } catch {
    throw new PasskeyError("malformed");
  }
  if (clientData.type !== type) throw new PasskeyError("wrong-type");
  if (
    clientData.challenge.length !== expected.challenge.length ||
    !NodeCrypto.timingSafeEqual(clientData.challenge, expected.challenge)
  ) {
    throw new PasskeyError("wrong-challenge");
  }
  if (clientData.origin !== expected.origin || clientData.crossOrigin === true) {
    throw new PasskeyError("wrong-origin");
  }
}

/** A new passkey from `navigator.credentials.create`, checked and turned into what is kept. */
export function verifyRegistration(input: {
  readonly response: unknown;
  readonly expected: ExpectedCeremony;
  readonly now: string;
}): FamilyPasskey {
  const response = (input.response ?? {}) as Record<string, unknown>;
  const clientDataJSON = fromBase64Url(response["clientDataJSON"]);
  checkClientData(clientDataJSON, ClientDataType.Create, input.expected);
  let attestation;
  try {
    attestation = parseAttestationObject(fromBase64Url(response["attestationObject"]));
  } catch (error) {
    if (error instanceof PasskeyError) throw error;
    throw new PasskeyError("malformed");
  }
  const authData = attestation.authenticatorData;
  if (!authData.verifyRelyingPartyIdHash(input.expected.rpId)) {
    throw new PasskeyError("wrong-relying-party");
  }
  if (!authData.userPresent || !authData.userVerified) throw new PasskeyError("not-verified");
  const credential = authData.credential;
  if (credential === null) throw new PasskeyError("malformed");
  const key = credential.publicKey;
  let algorithm: number;
  let publicKey: Record<string, string>;
  try {
    algorithm = key.algorithm();
    if (algorithm === coseAlgorithmES256 && key.type() === COSEKeyType.EC2) {
      const ec2 = key.ec2();
      if (ec2.curve !== coseEllipticCurveP256) throw new PasskeyError("unsupported-key");
      publicKey = {
        kty: "EC",
        crv: "P-256",
        x: bigintBytes(ec2.x, 32).toString("base64url"),
        y: bigintBytes(ec2.y, 32).toString("base64url"),
      };
    } else if (algorithm === coseAlgorithmRS256 && key.type() === COSEKeyType.RSA) {
      const rsa = key.rsa();
      publicKey = {
        kty: "RSA",
        n: bigintBytes(rsa.n).toString("base64url"),
        e: bigintBytes(rsa.e).toString("base64url"),
      };
    } else {
      throw new PasskeyError("unsupported-key");
    }
  } catch (error) {
    if (error instanceof PasskeyError) throw error;
    throw new PasskeyError("unsupported-key");
  }
  // The key must load: a malformed point fails here, not at the first yes.
  try {
    NodeCrypto.createPublicKey({ key: publicKey, format: "jwk" });
  } catch {
    throw new PasskeyError("unsupported-key");
  }
  return {
    id: toBase64Url(credential.id),
    algorithm,
    publicKey,
    rpId: input.expected.rpId,
    signCount: authData.signatureCounter,
    createdAt: input.now,
    lastUsedAt: null,
  };
}

/**
 * A yes from `navigator.credentials.get`, checked against the device's passkey. Returns the new
 * counter to keep.
 */
export function verifyAssertion(input: {
  readonly response: unknown;
  readonly credentialId: unknown;
  readonly passkeys: ReadonlyArray<FamilyPasskey>;
  readonly expected: ExpectedCeremony;
}): { readonly passkeyId: string; readonly signCount: number } {
  const response = (input.response ?? {}) as Record<string, unknown>;
  const credentialId = typeof input.credentialId === "string" ? input.credentialId : "";
  const passkey = input.passkeys.find((candidate) => candidate.id === credentialId);
  if (passkey === undefined) throw new PasskeyError("unknown-key");
  if (passkey.rpId !== input.expected.rpId) throw new PasskeyError("wrong-relying-party");
  const clientDataJSON = fromBase64Url(response["clientDataJSON"]);
  checkClientData(clientDataJSON, ClientDataType.Get, input.expected);
  const authenticatorData = fromBase64Url(response["authenticatorData"]);
  let authData;
  try {
    authData = parseAuthenticatorData(authenticatorData);
  } catch {
    throw new PasskeyError("malformed");
  }
  if (!authData.verifyRelyingPartyIdHash(input.expected.rpId)) {
    throw new PasskeyError("wrong-relying-party");
  }
  if (!authData.userPresent || !authData.userVerified) throw new PasskeyError("not-verified");
  const signature = fromBase64Url(response["signature"]);
  const message = createAssertionSignatureMessage(authenticatorData, clientDataJSON);
  let valid = false;
  try {
    const key = NodeCrypto.createPublicKey({ key: passkey.publicKey, format: "jwk" });
    // ES256 signatures arrive DER-encoded, which is Node's default for ECDSA.
    valid = NodeCrypto.verify("sha256", message, key, signature);
  } catch {
    valid = false;
  }
  if (!valid) throw new PasskeyError("bad-signature");
  // A counter of 0 means the authenticator keeps none (Apple's synced passkeys).
  if (
    (authData.signatureCounter !== 0 || passkey.signCount !== 0) &&
    authData.signatureCounter <= passkey.signCount
  ) {
    throw new PasskeyError("replayed-counter");
  }
  return { passkeyId: passkey.id, signCount: authData.signatureCounter };
}

/** The relying party for an origin: its host name (a passkey made on localhost works there only). */
export function relyingPartyFor(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    return url.hostname;
  } catch {
    return null;
  }
}
