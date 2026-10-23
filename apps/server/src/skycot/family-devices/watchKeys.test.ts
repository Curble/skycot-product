import { describe, expect, it } from "vite-plus/test";

import { watchSignedMessage } from "@t3tools/skycot-rules/people";

import { readWatchPublicKey, verifyWatchSignature, watchKeyId } from "./watchKeys.ts";

// Made once with Apple's CryptoKit (P256.Signing, as the Watch app signs), so the Mac and the
// Watch are checked to agree on the key format, the signature format and the message lines.
const CRYPTOKIT = {
  publicKey:
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEg0H4Q51OyQSq8FcZD2Ge57YQtkciQzxmw7TcEzPY0kRKd5ufd2JReej3wVgQf365rGInhAHv0WFCWtxcVEQZGA",
  challenge: "q3Vb8Gm1pYQh0m2u9X4ZtSMmzX1sV7nJw0cH8yKpLfA",
  action: "approve:thread-ava:req-1:3f2a1b0c9d8e7f6a5b4c3d2e",
  signature:
    "MEUCIQCv41eBEIH7eGTCSou2x7qrMskIiPmBThuIsMDE6tsCvAIgCA0rTZw8xRdxFrPPjdgdX2VO-eQF1d2vm_BnUcccFWI",
} as const;

describe("a Watch's signature", () => {
  it("accepts what CryptoKit on the Watch signs", () => {
    expect(() =>
      verifyWatchSignature({
        publicKey: CRYPTOKIT.publicKey,
        message: watchSignedMessage("approve", CRYPTOKIT.challenge, CRYPTOKIT.action),
        signature: CRYPTOKIT.signature,
      }),
    ).not.toThrow();
  });

  it("refuses it for any other action, purpose or challenge", () => {
    const tries = [
      watchSignedMessage("approve", CRYPTOKIT.challenge, "approve:thread-leo:req-1:x"),
      watchSignedMessage("register", CRYPTOKIT.challenge, CRYPTOKIT.action),
      watchSignedMessage("approve", "another", CRYPTOKIT.action),
    ];
    for (const message of tries) {
      expect(() =>
        verifyWatchSignature({
          publicKey: CRYPTOKIT.publicKey,
          message,
          signature: CRYPTOKIT.signature,
        }),
      ).toThrow(/bad-signature/);
    }
  });

  it("reads only P-256 public keys, and nothing malformed", () => {
    expect(() => readWatchPublicKey("")).toThrow(/malformed/);
    expect(() => readWatchPublicKey("not a key")).toThrow(/malformed/);
    expect(() => readWatchPublicKey(42)).toThrow(/malformed/);
    expect(readWatchPublicKey(CRYPTOKIT.publicKey).asymmetricKeyType).toBe("ec");
    expect(watchKeyId(CRYPTOKIT.publicKey)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
