// Checks the tunnel against the official Noise test vectors (see noise.vectors.testkit.ts for the
// sources): with the vectors' fixed keys, prologue and payloads, every handshake message, every
// transport ciphertext and the handshake hash must match the published bytes exactly. Our own
// round-trip tests (noise.test.ts) only prove that two copies of this code agree with each other;
// these prove it speaks the same Noise_IK_25519_ChaChaPoly_SHA256 as independent implementations.

import { describe, expect, it } from "vite-plus/test";

import { toHex } from "./encoding.ts";
import {
  keyPairFromSecret,
  PROTOCOL_NAME,
  readFirstMessage,
  readSecondMessage,
  SecureChannel,
  writeFirstMessage,
  writeSecondMessage,
} from "./noise.ts";
import { NOISE_IK_VECTORS } from "./noise.vectors.testkit.ts";

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) throw new Error(`Bad hex: ${hex}`);
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

describe("Noise IK against the official test vectors", () => {
  it("has the vectors for exactly this protocol from both sources", () => {
    expect(NOISE_IK_VECTORS.map((vector) => vector.source)).toEqual(["cacophony", "snow"]);
    for (const vector of NOISE_IK_VECTORS) expect(vector.protocol_name).toBe(PROTOCOL_NAME);
  });

  for (const vector of NOISE_IK_VECTORS) {
    it(`matches ${vector.source} byte for byte`, () => {
      const initiatorStatic = keyPairFromSecret(fromHex(vector.init_static));
      const initiatorEphemeral = keyPairFromSecret(fromHex(vector.init_ephemeral));
      const responderStatic = keyPairFromSecret(fromHex(vector.resp_static));
      const responderEphemeral = keyPairFromSecret(fromHex(vector.resp_ephemeral));
      // The initiator's pre-known copy of the responder's key ("<- s") is the responder's real key.
      expect(vector.init_remote_static).toBe(toHex(responderStatic.publicKey));
      const [first, second, ...transport] = vector.messages;
      if (first === undefined || second === undefined) throw new Error("Too few messages.");

      // Message 1, initiator -> responder: e, es, s, ss.
      const written = writeFirstMessage({
        s: initiatorStatic,
        rs: fromHex(vector.init_remote_static),
        prologue: fromHex(vector.init_prologue),
        payload: fromHex(first.payload),
        e: initiatorEphemeral,
      });
      expect(toHex(written.message)).toBe(first.ciphertext);
      const read = readFirstMessage({
        s: responderStatic,
        prologue: fromHex(vector.resp_prologue),
        message: fromHex(first.ciphertext),
      });
      expect(toHex(read.payload)).toBe(first.payload);
      expect(toHex(read.pending.rs)).toBe(toHex(initiatorStatic.publicKey));

      // Message 2, responder -> initiator: e, ee, se. The handshake is then complete.
      const answered = writeSecondMessage(
        read.pending,
        fromHex(second.payload),
        responderEphemeral,
      );
      expect(toHex(answered.message)).toBe(second.ciphertext);
      const finished = readSecondMessage(written.pending, fromHex(second.ciphertext));
      expect(toHex(finished.payload)).toBe(second.payload);
      expect(toHex(finished.handshakeHash)).toBe(toHex(answered.handshakeHash));
      if (vector.handshake_hash !== undefined) {
        expect(toHex(finished.handshakeHash)).toBe(vector.handshake_hash);
      }

      // Transport messages keep alternating, starting again with the initiator.
      const initiator = new SecureChannel(finished);
      const responder = new SecureChannel(answered);
      expect(transport.length).toBeGreaterThan(0);
      transport.forEach((message, index) => {
        const [sender, receiver] =
          index % 2 === 0 ? [initiator, responder] : [responder, initiator];
        expect(toHex(sender.seal(fromHex(message.payload)))).toBe(message.ciphertext);
        expect(toHex(receiver.open(fromHex(message.ciphertext)))).toBe(message.payload);
      });
    });
  }
});
