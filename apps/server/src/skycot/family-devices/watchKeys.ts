// A grown-up's Apple Watch saying yes (Phase 4, decision 4): checking its signature. Pure, like
// passkeys.ts: the Watch keeps a P-256 signing key (in its Secure Enclave where it has one) and
// the engine keeps only the public half; checking a signature is Node's own crypto (OpenSSL).
//
// What the Watch signs is `watchSignedMessage(purpose, challenge, action)` from
// @t3tools/skycot-rules/people: a fixed first line, what it is for, the engine's challenge for
// that one action, and the action itself (for a yes, the request and the fingerprint of the
// card the Watch showed). The engine rebuilds the message from its own record of the
// challenge, so the phone that carries it can't swap the request, and a signature for one
// request never fits another.

// Signature checks have no Effect counterpart; these are pure calls.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

export type WatchKeyFailure = "malformed" | "unsupported-key" | "bad-signature";

export class WatchKeyError extends Error {
  readonly reason: WatchKeyFailure;
  constructor(reason: WatchKeyFailure) {
    super(`Watch check failed: ${reason}`);
    this.reason = reason;
  }
}

const bytesOf = (value: unknown, max: number): Buffer => {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new WatchKeyError("malformed");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0) throw new WatchKeyError("malformed");
  return bytes;
};

/** The Watch's public key (SPKI DER, base64url), if it is a P-256 key. */
export function readWatchPublicKey(value: unknown): NodeCrypto.KeyObject {
  let key: NodeCrypto.KeyObject;
  try {
    key = NodeCrypto.createPublicKey({ key: bytesOf(value, 512), format: "der", type: "spki" });
  } catch (error) {
    if (error instanceof WatchKeyError) throw error;
    throw new WatchKeyError("malformed");
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new WatchKeyError("unsupported-key");
  }
  return key;
}

/** A short, stable id for a Watch key: the first 16 bytes of its SHA-256, base64url. */
export function watchKeyId(publicKey: string): string {
  return NodeCrypto.createHash("sha256")
    .update(Buffer.from(publicKey, "base64url"))
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

/** Throws unless `signature` (ECDSA, DER, base64url) is the Watch key's over `message`. */
export function verifyWatchSignature(input: {
  readonly publicKey: string;
  readonly message: string;
  readonly signature: unknown;
}): void {
  const key = readWatchPublicKey(input.publicKey);
  const signature = bytesOf(input.signature, 256);
  let good = false;
  try {
    good = NodeCrypto.verify(
      "sha256",
      Buffer.from(input.message, "utf8"),
      { key, dsaEncoding: "der" },
      signature,
    );
  } catch {
    good = false;
  }
  if (!good) throw new WatchKeyError("bad-signature");
}
