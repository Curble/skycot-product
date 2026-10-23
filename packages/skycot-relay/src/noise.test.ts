import { describe, expect, it } from "vite-plus/test";

import { concatBytes, equalBytes, fromBase64Url, toBase32, toBase64Url, utf8 } from "./encoding.ts";
import {
  generateKeyPair,
  readFirstMessage,
  readSecondMessage,
  SecureChannel,
  writeFirstMessage,
  writeSecondMessage,
} from "./noise.ts";

const prologue = utf8("skycot-relay/1|testhome");

function handshake(options: { readonly initiatorKnows?: Uint8Array } = {}) {
  const mac = generateKeyPair();
  const device = generateKeyPair();
  const first = writeFirstMessage({
    s: device,
    rs: options.initiatorKnows ?? mac.publicKey,
    prologue,
    payload: utf8("hello"),
  });
  const read = readFirstMessage({ s: mac, prologue, message: first.message });
  const second = writeSecondMessage(read.pending, utf8("welcome"));
  const finished = readSecondMessage(first.pending, second.message);
  return { mac, device, first, read, second, finished };
}

describe("Noise IK handshake", () => {
  it("authenticates both keys and agrees on the session", () => {
    const { device, read, second, finished } = handshake();
    expect(new TextDecoder().decode(read.payload)).toBe("hello");
    expect(equalBytes(read.pending.rs, device.publicKey)).toBe(true);
    expect(new TextDecoder().decode(finished.payload)).toBe("welcome");
    expect(equalBytes(finished.handshakeHash, second.handshakeHash)).toBe(true);

    const deviceSide = new SecureChannel(finished);
    const macSide = new SecureChannel(second);
    const sealed = deviceSide.seal(utf8("GET /api/skycot/family"));
    expect(new TextDecoder().decode(macSide.open(sealed))).toBe("GET /api/skycot/family");
    const answer = macSide.seal(utf8("200"));
    expect(new TextDecoder().decode(deviceSide.open(answer))).toBe("200");
  });

  it("never puts the device's key or the payload on the wire in the clear", () => {
    const { device, first } = handshake();
    const wire = toBase64Url(first.message);
    expect(wire.includes(toBase64Url(device.publicKey))).toBe(false);
    expect(new TextDecoder("latin1").decode(first.message).includes("hello")).toBe(false);
  });

  it("refuses a first message sealed for another Mac", () => {
    const stranger = generateKeyPair();
    const mac = generateKeyPair();
    const first = writeFirstMessage({
      s: generateKeyPair(),
      rs: stranger.publicKey,
      prologue,
      payload: utf8("hi"),
    });
    expect(() => readFirstMessage({ s: mac, prologue, message: first.message })).toThrow();
  });

  it("refuses a handshake for another home (the prologue)", () => {
    const mac = generateKeyPair();
    const first = writeFirstMessage({
      s: generateKeyPair(),
      rs: mac.publicKey,
      prologue,
      payload: utf8("hi"),
    });
    expect(() =>
      readFirstMessage({
        s: mac,
        prologue: utf8("skycot-relay/1|otherhome"),
        message: first.message,
      }),
    ).toThrow();
  });

  it("refuses an answer from anyone but the Mac the device knows", () => {
    const mac = generateKeyPair();
    const impostor = generateKeyPair();
    const device = generateKeyPair();
    const first = writeFirstMessage({ s: device, rs: mac.publicKey, prologue, payload: utf8("") });
    // The relay (or anyone) cannot read message 1 without the Mac's key, so it cannot answer it.
    expect(() => readFirstMessage({ s: impostor, prologue, message: first.message })).toThrow();
    // A made-up answer fails the device's check.
    const fake = concatBytes(generateKeyPair().publicKey, new Uint8Array(16));
    expect(() => readSecondMessage(first.pending, fake)).toThrow();
  });

  it("detects a tampered frame", () => {
    const { finished, second } = handshake();
    const sealed = new SecureChannel(finished).seal(utf8("approve request 1"));
    sealed[3] = sealed[3]! ^ 0x01;
    expect(() => new SecureChannel(second).open(sealed)).toThrow();
  });

  it("refuses a replayed or reordered frame", () => {
    const { finished, second } = handshake();
    const deviceSide = new SecureChannel(finished);
    const macSide = new SecureChannel(second);
    const one = deviceSide.seal(utf8("one"));
    const two = deviceSide.seal(utf8("two"));
    expect(new TextDecoder().decode(macSide.open(one))).toBe("one");
    expect(() => macSide.open(one)).toThrow();

    const fresh = handshake();
    const sender = new SecureChannel(fresh.finished);
    const receiver = new SecureChannel(fresh.second);
    const first = sender.seal(utf8("first"));
    const later = sender.seal(utf8("later"));
    expect(() => receiver.open(later)).toThrow();
    expect(first.length).toBeGreaterThan(0);
    expect(two.length).toBeGreaterThan(0);
  });

  it("gives every handshake fresh keys (forward secrecy from the ephemeral keys)", () => {
    const a = handshake();
    const b = handshake();
    expect(equalBytes(a.finished.handshakeHash, b.finished.handshakeHash)).toBe(false);
  });
});

describe("encoding", () => {
  it("round-trips base64url and refuses non-canonical text", () => {
    for (const length of [0, 1, 2, 3, 31, 32, 33]) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37) & 0xff);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
    expect(fromBase64Url("AB")).toBeNull();
    expect(fromBase64Url("a+b/")).toBeNull();
  });

  it("writes RFC 4648 base32", () => {
    expect(toBase32(utf8("foobar"))).toBe("mzxw6ytboi");
  });
});
