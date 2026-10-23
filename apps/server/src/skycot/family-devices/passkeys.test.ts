// A software authenticator needs Node's own crypto.
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics preferSchemaOverJson:off
// Passkeys with a software authenticator: a real P-256 key made here, real CBOR and real
// signatures, checked by the same code the engine runs. No browser needed.
import * as NodeCrypto from "node:crypto";

import { assert, describe, it } from "@effect/vitest";

import {
  makeChallenge,
  PasskeyError,
  relyingPartyFor,
  verifyAssertion,
  verifyRegistration,
} from "./passkeys.ts";

// A tiny CBOR encoder: enough for an attestation object and a COSE key.
function head(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  const out = Buffer.alloc(3);
  out[0] = (major << 5) | 25;
  out.writeUInt16BE(value, 1);
  return out;
}
function cbor(value: unknown): Buffer {
  if (typeof value === "number") {
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array)
    return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  if (value instanceof Map) {
    const parts: Array<Buffer> = [head(5, value.size)];
    for (const [key, entry] of value) parts.push(cbor(key), cbor(entry));
    return Buffer.concat(parts);
  }
  throw new Error("unsupported");
}

const RP = "localhost";
const ORIGIN = "http://localhost:3790";

function softwareAuthenticator() {
  const { privateKey, publicKey } = NodeCrypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credentialId = NodeCrypto.randomBytes(16);
  let counter = 0;
  const rpIdHash = NodeCrypto.createHash("sha256").update(RP).digest();
  const authData = (flags: number, withCredential: boolean, rpHash = rpIdHash) => {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    const parts: Array<Buffer> = [Buffer.from(rpHash), Buffer.from([flags]), count];
    if (withCredential) {
      const coseKey = cbor(
        new Map<number, unknown>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(jwk.x!, "base64url")],
          [-3, Buffer.from(jwk.y!, "base64url")],
        ]),
      );
      const length = Buffer.alloc(2);
      length.writeUInt16BE(credentialId.length);
      parts.push(Buffer.alloc(16), length, Buffer.from(credentialId), Buffer.from(coseKey));
    }
    return Buffer.concat(parts);
  };
  const clientData = (type: string, challenge: Uint8Array, origin = ORIGIN) =>
    Buffer.from(
      JSON.stringify({ type, challenge: Buffer.from(challenge).toString("base64url"), origin }),
    );
  return {
    id: credentialId.toString("base64url"),
    create(
      challenge: Uint8Array,
      options: { readonly origin?: string; readonly flags?: number } = {},
    ) {
      const attestationObject = cbor(
        new Map<string, unknown>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData(options.flags ?? 0x45, true)],
        ]),
      );
      return {
        clientDataJSON: clientData("webauthn.create", challenge, options.origin).toString(
          "base64url",
        ),
        attestationObject: attestationObject.toString("base64url"),
      };
    },
    get(
      challenge: Uint8Array,
      options: {
        readonly tamper?: boolean;
        readonly flags?: number;
        readonly keepCounter?: boolean;
      } = {},
    ) {
      if (options.keepCounter !== true) counter += 1;
      const data = authData(options.flags ?? 0x05, false);
      const client = clientData("webauthn.get", challenge);
      const message = Buffer.concat([
        data,
        NodeCrypto.createHash("sha256").update(client).digest(),
      ]);
      const signature = NodeCrypto.sign(
        "sha256",
        options.tamper ? Buffer.concat([message, Buffer.from([1])]) : message,
        privateKey,
      );
      return {
        clientDataJSON: client.toString("base64url"),
        authenticatorData: data.toString("base64url"),
        signature: signature.toString("base64url"),
      };
    },
  };
}

const failure = (run: () => unknown): string | null => {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof PasskeyError ? error.reason : "other";
  }
};

describe("passkeys", () => {
  it("registers a passkey made for this device, and says yes with it once per challenge", () => {
    const authenticator = softwareAuthenticator();
    const challenge = makeChallenge("register");
    const expected = { challenge, origin: ORIGIN, rpId: RP };
    const passkey = verifyRegistration({
      response: authenticator.create(challenge),
      expected,
      now: "2026-10-23T09:00:00.000Z",
    });
    assert.equal(passkey.id, authenticator.id);
    assert.equal(passkey.algorithm, -7);
    assert.equal(passkey.publicKey["kty"], "EC");

    const yes = makeChallenge("approve:thread:req:fingerprint");
    const used = verifyAssertion({
      response: authenticator.get(yes),
      credentialId: authenticator.id,
      passkeys: [passkey],
      expected: { challenge: yes, origin: ORIGIN, rpId: RP },
    });
    assert.equal(used.signCount, 1);

    // A signature over anything else, another challenge, or a counter that did not move: refused.
    const other = makeChallenge("approve:thread:req:fingerprint");
    assert.equal(
      failure(() =>
        verifyAssertion({
          response: authenticator.get(other, { tamper: true }),
          credentialId: authenticator.id,
          passkeys: [{ ...passkey, signCount: 1 }],
          expected: { challenge: other, origin: ORIGIN, rpId: RP },
        }),
      ),
      "bad-signature",
    );
    assert.equal(
      failure(() =>
        verifyAssertion({
          response: authenticator.get(other),
          credentialId: authenticator.id,
          passkeys: [{ ...passkey, signCount: 1 }],
          expected: { challenge: yes, origin: ORIGIN, rpId: RP },
        }),
      ),
      "wrong-challenge",
    );
    assert.equal(
      failure(() =>
        verifyAssertion({
          response: authenticator.get(other, { keepCounter: true }),
          credentialId: authenticator.id,
          passkeys: [{ ...passkey, signCount: 50 }],
          expected: { challenge: other, origin: ORIGIN, rpId: RP },
        }),
      ),
      "replayed-counter",
    );
    // Without Face ID or the passcode (user verification), a yes is not a grown-up's yes.
    assert.equal(
      failure(() =>
        verifyAssertion({
          response: authenticator.get(other, { flags: 0x01 }),
          credentialId: authenticator.id,
          passkeys: [passkey],
          expected: { challenge: other, origin: ORIGIN, rpId: RP },
        }),
      ),
      "not-verified",
    );
    // Another device's key is not this device's.
    assert.equal(
      failure(() =>
        verifyAssertion({
          response: authenticator.get(other),
          credentialId: "someone-else",
          passkeys: [passkey],
          expected: { challenge: other, origin: ORIGIN, rpId: RP },
        }),
      ),
      "unknown-key",
    );
  });

  it("refuses a registration from another page or without the person checked", () => {
    const authenticator = softwareAuthenticator();
    const challenge = makeChallenge("register");
    const expected = { challenge, origin: ORIGIN, rpId: RP };
    assert.equal(
      failure(() =>
        verifyRegistration({
          response: authenticator.create(challenge, { origin: "http://evil.localhost:3790" }),
          expected,
          now: "x",
        }),
      ),
      "wrong-origin",
    );
    assert.equal(
      failure(() =>
        verifyRegistration({
          response: authenticator.create(challenge, { flags: 0x41 }),
          expected,
          now: "x",
        }),
      ),
      "not-verified",
    );
    assert.equal(
      failure(() =>
        verifyRegistration({
          response: authenticator.create(makeChallenge("register")),
          expected,
          now: "x",
        }),
      ),
      "wrong-challenge",
    );
    assert.equal(
      failure(() => verifyRegistration({ response: { clientDataJSON: 5 }, expected, now: "x" })),
      "malformed",
    );
  });

  it("passkeys need a secure address: localhost or https", () => {
    assert.equal(relyingPartyFor("http://localhost:3790"), "localhost");
    assert.equal(relyingPartyFor("https://mac.tail1234.ts.net"), "mac.tail1234.ts.net");
    assert.isNull(relyingPartyFor("http://192.168.1.20:3790"));
    assert.isNull(relyingPartyFor("nonsense"));
  });
});
