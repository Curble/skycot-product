// The sealed tunnel between a linked device and its home Mac: the Noise protocol framework's
// IK handshake, Noise_IK_25519_ChaChaPoly_SHA256 (https://noiseprotocol.org/noise.html, rev 34),
// written straight from the specification on audited primitives (@noble: X25519, ChaCha20-
// Poly1305, SHA-256/HMAC). Nothing here is new cryptography; the names follow the spec so a
// reviewer can check it line by line against sections 5 and 7.
//
// Why IK: the device learns the Mac's static key from the QR code before it ever connects
// (the "K"), and sends its own static key encrypted in the first message (the "I"), so after
// one round trip both sides are authenticated and hold fresh session keys with forward secrecy.
// The relay only ever carries the bytes this file produces.
//
// What IK alone does not stop is a replayed first message (spec section 7.7): the device puts a
// strictly increasing timestamp in it and the Mac refuses one that is not newer than the last it
// accepted from that key (see host.ts). Transport messages use the spec's implicit counters, so a
// replayed, dropped or reordered frame fails to decrypt and the channel is closed.

import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { x25519 } from "@noble/curves/ed25519";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";

import { concatBytes, utf8 } from "./encoding.ts";

export const PROTOCOL_NAME = "Noise_IK_25519_ChaChaPoly_SHA256";
export const DHLEN = 32;
const HASHLEN = 32;
const TAGLEN = 16;
/** Spec section 3: no Noise message is longer than this. */
export const MAX_MESSAGE_LENGTH = 65535;
/** The most plaintext one transport message can carry. */
export const MAX_PLAINTEXT_LENGTH = MAX_MESSAGE_LENGTH - TAGLEN;
// Far below the spec's 2^64-1; a channel this old is simply closed and opened again.
const MAX_NONCE = 2 ** 48;

export interface KeyPair {
  readonly publicKey: Uint8Array;
  readonly secretKey: Uint8Array;
}

export class NoiseError extends Error {
  override readonly name = "NoiseError";
}

export function generateKeyPair(): KeyPair {
  const secretKey = x25519.utils.randomPrivateKey();
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export function keyPairFromSecret(secretKey: Uint8Array): KeyPair {
  if (secretKey.length !== DHLEN) throw new NoiseError("A Noise key is 32 bytes.");
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

function dh(keyPair: KeyPair, publicKey: Uint8Array): Uint8Array {
  // noble refuses low-order points (an all-zero shared secret), which would otherwise let an
  // attacker force a known key.
  try {
    return x25519.getSharedSecret(keyPair.secretKey, publicKey);
  } catch {
    throw new NoiseError("Invalid public key.");
  }
}

/** Section 4.3 HKDF with HMAC-SHA256. */
function hkdf(chainingKey: Uint8Array, inputKeyMaterial: Uint8Array): [Uint8Array, Uint8Array] {
  const tempKey = hmac(sha256, chainingKey, inputKeyMaterial);
  const output1 = hmac(sha256, tempKey, Uint8Array.of(0x01));
  const output2 = hmac(sha256, tempKey, concatBytes(output1, Uint8Array.of(0x02)));
  return [output1, output2];
}

/** Section 5.1. */
export class CipherState {
  private k: Uint8Array | null;
  private n = 0;

  constructor(key: Uint8Array | null = null) {
    this.k = key;
  }

  hasKey(): boolean {
    return this.k !== null;
  }

  private nonce(): Uint8Array {
    if (this.n >= MAX_NONCE) throw new NoiseError("This channel has carried too many messages.");
    // 32 bits of zeros, then the 64-bit counter little-endian (section 12.3).
    const nonce = new Uint8Array(12);
    let n = this.n;
    for (let index = 4; index < 12; index += 1) {
      nonce[index] = n % 256;
      n = Math.floor(n / 256);
    }
    return nonce;
  }

  encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    if (this.k === null) return plaintext;
    const ciphertext = chacha20poly1305(this.k, this.nonce(), ad).encrypt(plaintext);
    this.n += 1;
    return ciphertext;
  }

  decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    if (this.k === null) return ciphertext;
    let plaintext: Uint8Array;
    try {
      plaintext = chacha20poly1305(this.k, this.nonce(), ad).decrypt(ciphertext);
    } catch {
      // The counter does not move on failure (spec 5.1), but callers close the channel anyway.
      throw new NoiseError("A message failed its seal check.");
    }
    this.n += 1;
    return plaintext;
  }
}

/** Section 5.2. */
class SymmetricState {
  private ck: Uint8Array;
  h: Uint8Array;
  private cipher = new CipherState();

  constructor(protocolName: string) {
    const name = utf8(protocolName);
    // A name of HASHLEN bytes or fewer is zero-padded, a longer one hashed.
    if (name.length <= HASHLEN) {
      this.h = new Uint8Array(HASHLEN);
      this.h.set(name);
    } else {
      this.h = sha256(name);
    }
    this.ck = this.h;
  }

  mixKey(inputKeyMaterial: Uint8Array): void {
    const [ck, tempK] = hkdf(this.ck, inputKeyMaterial);
    this.ck = ck;
    this.cipher = new CipherState(tempK);
  }

  mixHash(data: Uint8Array): void {
    this.h = sha256(concatBytes(this.h, data));
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const ciphertext = this.cipher.encryptWithAd(this.h, plaintext);
    this.mixHash(ciphertext);
    return ciphertext;
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    const plaintext = this.cipher.decryptWithAd(this.h, ciphertext);
    this.mixHash(ciphertext);
    return plaintext;
  }

  split(): [CipherState, CipherState] {
    const [k1, k2] = hkdf(this.ck, new Uint8Array(0));
    return [new CipherState(k1), new CipherState(k2)];
  }
}

/** Both directions of an established channel. */
export interface TransportKeys {
  readonly send: CipherState;
  readonly receive: CipherState;
  /** Section 11.2 channel binding: the same 32 bytes on both ends, unique to this handshake. */
  readonly handshakeHash: Uint8Array;
}

export interface InitiatorPending {
  readonly symmetric: SymmetricState;
  readonly s: KeyPair;
  readonly e: KeyPair;
}

function initialise(prologue: Uint8Array, responderStatic: Uint8Array): SymmetricState {
  const symmetric = new SymmetricState(PROTOCOL_NAME);
  symmetric.mixHash(prologue);
  // IK's pre-message pattern: "<- s".
  symmetric.mixHash(responderStatic);
  return symmetric;
}

/** Initiator, message 1: `-> e, es, s, ss` and an encrypted payload. */
export function writeFirstMessage(input: {
  readonly s: KeyPair;
  readonly rs: Uint8Array;
  readonly prologue: Uint8Array;
  readonly payload: Uint8Array;
  /** Tests only: a fixed ephemeral key. */
  readonly e?: KeyPair;
}): { readonly message: Uint8Array; readonly pending: InitiatorPending } {
  if (input.rs.length !== DHLEN) throw new NoiseError("The Mac's key is 32 bytes.");
  const symmetric = initialise(input.prologue, input.rs);
  const e = input.e ?? generateKeyPair();
  symmetric.mixHash(e.publicKey);
  symmetric.mixKey(dh(e, input.rs));
  const encryptedStatic = symmetric.encryptAndHash(input.s.publicKey);
  symmetric.mixKey(dh(input.s, input.rs));
  const encryptedPayload = symmetric.encryptAndHash(input.payload);
  const message = concatBytes(e.publicKey, encryptedStatic, encryptedPayload);
  if (message.length > MAX_MESSAGE_LENGTH) throw new NoiseError("The first message is too long.");
  return { message, pending: { symmetric, s: input.s, e } };
}

/** Initiator, message 2 received: `<- e, ee, se`; the channel is open. */
export function readSecondMessage(
  pending: InitiatorPending,
  message: Uint8Array,
): TransportKeys & { readonly payload: Uint8Array } {
  if (message.length < DHLEN + TAGLEN) throw new NoiseError("The answer is too short.");
  const { symmetric } = pending;
  const re = message.subarray(0, DHLEN);
  symmetric.mixHash(re);
  symmetric.mixKey(dh(pending.e, re));
  symmetric.mixKey(dh(pending.s, re));
  const payload = symmetric.decryptAndHash(message.subarray(DHLEN));
  const [toResponder, toInitiator] = symmetric.split();
  return { payload, send: toResponder, receive: toInitiator, handshakeHash: symmetric.h };
}

export interface ResponderPending {
  readonly symmetric: SymmetricState;
  readonly s: KeyPair;
  readonly re: Uint8Array;
  /** The initiator's static key, now authenticated by the `ss` step. */
  readonly rs: Uint8Array;
}

/** Responder, message 1 received. Throws when it was not sealed for this key. */
export function readFirstMessage(input: {
  readonly s: KeyPair;
  readonly prologue: Uint8Array;
  readonly message: Uint8Array;
}): { readonly payload: Uint8Array; readonly pending: ResponderPending } {
  const { message } = input;
  if (message.length < DHLEN + DHLEN + TAGLEN + TAGLEN) {
    throw new NoiseError("The first message is too short.");
  }
  const symmetric = initialise(input.prologue, input.s.publicKey);
  const re = message.slice(0, DHLEN);
  symmetric.mixHash(re);
  symmetric.mixKey(dh(input.s, re));
  const rs = symmetric.decryptAndHash(message.subarray(DHLEN, DHLEN + DHLEN + TAGLEN));
  symmetric.mixKey(dh(input.s, rs));
  const payload = symmetric.decryptAndHash(message.subarray(DHLEN + DHLEN + TAGLEN));
  return { payload, pending: { symmetric, s: input.s, re, rs } };
}

/** Responder, message 2: `<- e, ee, se` and an encrypted payload; the channel is open. */
export function writeSecondMessage(
  pending: ResponderPending,
  payload: Uint8Array,
  fixedEphemeral?: KeyPair,
): TransportKeys & { readonly message: Uint8Array } {
  const { symmetric } = pending;
  const e = fixedEphemeral ?? generateKeyPair();
  symmetric.mixHash(e.publicKey);
  symmetric.mixKey(dh(e, pending.re));
  symmetric.mixKey(dh(e, pending.rs));
  const encryptedPayload = symmetric.encryptAndHash(payload);
  const [toResponder, toInitiator] = symmetric.split();
  return {
    message: concatBytes(e.publicKey, encryptedPayload),
    send: toInitiator,
    receive: toResponder,
    handshakeHash: symmetric.h,
  };
}

const EMPTY = new Uint8Array(0);

/** One open channel: seal what goes out, open what comes in, strictly in order. */
export class SecureChannel {
  private readonly keys: TransportKeys;

  constructor(keys: TransportKeys) {
    this.keys = keys;
  }

  get handshakeHash(): Uint8Array {
    return this.keys.handshakeHash;
  }

  seal(plaintext: Uint8Array): Uint8Array {
    if (plaintext.length > MAX_PLAINTEXT_LENGTH) throw new NoiseError("A frame is too long.");
    return this.keys.send.encryptWithAd(EMPTY, plaintext);
  }

  open(ciphertext: Uint8Array): Uint8Array {
    if (ciphertext.length > MAX_MESSAGE_LENGTH) throw new NoiseError("A frame is too long.");
    return this.keys.receive.decryptWithAd(EMPTY, ciphertext);
  }
}
