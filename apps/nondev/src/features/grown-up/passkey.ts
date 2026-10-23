// Face ID or Touch ID on a grown-up's own device, through the browser's WebAuthn (passkeys). The
// engine makes every challenge and checks every answer (apps/server/src/skycot/family-devices/
// passkeys.ts); this file only hands them to the browser and back. Passkeys need a secure page:
// the Mac's own address (localhost) or https. Over plain home Wi-Fi the parent code is the way.
import { familyApi, type ApproverProof } from "../family/api";
import type { FamilyResult } from "../family/family";

const fromBase64Url = (value: string): ArrayBuffer => {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
};

const toBase64Url = (buffer: ArrayBuffer | ArrayBufferView): string => {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Whether this page can use passkeys at all (a secure page with WebAuthn). */
export function passkeysPossible(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential === "function" &&
    typeof navigator.credentials?.create === "function"
  );
}

type Options = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Sets up Face ID on this device: the parent code once, then the browser's own sheet. */
export async function registerPasskey(code: string): Promise<FamilyResult<true>> {
  const options = await familyApi.passkeyOptions({ code });
  if (!options.ok) return options;
  const raw = options.value as Options;
  const user = (raw["user"] ?? {}) as Options;
  const rp = (raw["rp"] ?? {}) as Options;
  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: fromBase64Url(text(raw["challenge"])),
        rp: { id: text(rp["id"]), name: text(rp["name"]) || "SKYCOT" },
        user: {
          id: fromBase64Url(text(user["id"])),
          name: text(user["name"]),
          displayName: text(user["displayName"]),
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
        attestation: "none",
        timeout: 120_000,
      },
    })) as PublicKeyCredential | null;
    if (credential === null) return cancelled();
    const response = credential.response as AuthenticatorAttestationResponse;
    return familyApi.passkeyRegister({
      challenge: text(raw["challenge"]),
      response: {
        clientDataJSON: toBase64Url(response.clientDataJSON),
        attestationObject: toBase64Url(response.attestationObject),
      },
    });
  } catch {
    return cancelled();
  }
}

/** One Face ID check for one action the engine named (a yes, or more time). */
export async function passkeyProof(
  challengeInput: Record<string, string>,
): Promise<FamilyResult<ApproverProof>> {
  const challenge = await familyApi.approverChallenge(challengeInput);
  if (!challenge.ok) return challenge;
  const raw = challenge.value as Options;
  const allow = Array.isArray(raw["allowCredentials"])
    ? (raw["allowCredentials"] as Array<Options>)
    : [];
  try {
    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge: fromBase64Url(text(raw["challenge"])),
        rpId: text(raw["rpId"]),
        allowCredentials: allow.map((entry) => ({
          type: "public-key" as const,
          id: fromBase64Url(text(entry["id"])),
        })),
        userVerification: "required",
        timeout: 120_000,
      },
    })) as PublicKeyCredential | null;
    if (credential === null) return cancelled();
    const response = credential.response as AuthenticatorAssertionResponse;
    return {
      ok: true,
      value: {
        type: "passkey",
        credentialId: toBase64Url(credential.rawId),
        challenge: text(raw["challenge"]),
        response: {
          clientDataJSON: toBase64Url(response.clientDataJSON),
          authenticatorData: toBase64Url(response.authenticatorData),
          signature: toBase64Url(response.signature),
        },
      },
    };
  } catch {
    return cancelled();
  }
}

function cancelled(): FamilyResult<never> {
  return {
    ok: false,
    reason: "passkey",
    message: "Face ID was cancelled. Try again, or use the parent code.",
  };
}
