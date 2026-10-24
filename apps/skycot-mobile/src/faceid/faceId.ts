/**
 * Face ID to say yes, on a grown-up's own iPhone: the steps, with the Mac and the Secure
 * Enclave passed in, so they are tested without either.
 *
 * The design is the Watch's (Phase 4), with the key on the phone itself:
 * - Set up once with the parent code ("Use Face ID to say yes", This device): each linked Mac
 *   checks the code and gives a one-use registration challenge; the phone makes its key in the
 *   Secure Enclave and, after one Face ID check, signs every Mac's challenge; each Mac keeps the
 *   public half on this device's record.
 * - Allow once: the Mac gives a one-use challenge for this one request (its thread, id and the
 *   fingerprint of the card shown); Face ID; the key signs it; the Mac checks the signature with
 *   the key it kept, against its own record of the challenge, and only then says yes.
 * - Anything short of that (Face ID cancelled or failed, no key, a Mac that doesn't know the
 *   key) falls back to the parent code sheet, as before. Decline needs neither.
 * - "Stop using Face ID" removes the key from this phone (it can never sign again) and asks
 *   each Mac to forget it; no code, because it only takes away.
 */
import type {
  CreatedDeviceKey,
  DeviceKeyBiometry,
  DeviceKeyErrorCode,
  SignRequest,
} from "../../modules/skycot-device-key";
import type { FamilyResult, familyApi } from "../family/api";
import type { MacTransport } from "../transport/MacTransport";

/** The Mac's part, as `familyApi` has it. */
export type FaceIdApi = Pick<
  typeof familyApi,
  | "deviceKeyOptions"
  | "deviceKeyRegister"
  | "deviceKeyForget"
  | "deviceKeyChallenge"
  | "answerRequest"
>;

/** The Secure Enclave's part, as `SkycotDeviceKey` has it. */
export interface FaceIdSigner {
  create(reason: string, requests: ReadonlyArray<SignRequest>): Promise<CreatedDeviceKey>;
  sign(reason: string, requests: ReadonlyArray<SignRequest>): Promise<ReadonlyArray<string>>;
  remove(): void;
}

export interface FaceIdMac {
  readonly macId: string;
  readonly macName: string;
  readonly transport: MacTransport;
}

/** "Face ID", or "Touch ID" on an iPad that has that instead. */
export function biometryLabel(biometry: DeviceKeyBiometry | "none" | null | undefined): string {
  return biometry === "touch-id" ? "Touch ID" : biometry === "optic-id" ? "Optic ID" : "Face ID";
}

/** What Face ID's own sheet says, for one request: "Allow Ava's request". */
export function allowReason(childName: string | null | undefined): string {
  const name = typeof childName === "string" ? childName.trim() : "";
  return name.length > 0 ? `Allow ${name}'s request` : "Allow this request";
}

/** What Face ID's sheet says while setting up: "Use Face ID to say yes". */
export function setUpReason(label = "Face ID"): string {
  return `Use ${label} to say yes`;
}

/** The code a rejected native call carries ("cancelled", "fallback", …), or "failed". */
export function deviceKeyErrorCode(error: unknown): DeviceKeyErrorCode {
  const code =
    typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  switch (code) {
    case "cancelled":
    case "fallback":
    case "unavailable":
    case "locked-out":
    case "no-key":
    case "key-invalid":
      return code;
    default:
      return "failed";
  }
}

/**
 * What the parent code sheet says above the code when Face ID didn't say yes: nothing when the
 * grown-up chose the code (cancelled, or "Use parent code"), otherwise why not.
 */
export function fallbackNote(code: DeviceKeyErrorCode, label = "Face ID"): string | null {
  switch (code) {
    case "cancelled":
    case "fallback":
      return null;
    case "locked-out":
      return `${label} is locked after too many tries. Use the parent code this time.`;
    case "key-invalid":
      return `${label} on this iPhone changed, so it can't say yes until you set it up again in This device. Use the parent code this time.`;
    case "no-key":
      return `${label} isn't set up on this iPhone. Use the parent code, or set it up in This device.`;
    case "unavailable":
      return `${label} isn't available right now. Use the parent code this time.`;
    default:
      return `${label} didn't confirm that. Use the parent code this time.`;
  }
}

export type AllowOutcome =
  | { readonly kind: "allowed" }
  /** Ask for the parent code instead, with a sentence to show when there is one. */
  | { readonly kind: "use-code"; readonly note: string | null }
  /** The request itself can't be answered now (gone, lapsed, changed, the Mac unreachable). */
  | { readonly kind: "problem"; readonly message: string };

/** The Mac's reasons that mean "this key can't say yes here; the code still can". */
const KEY_REASONS = new Set(["device-key", "proof-needed"]);

/** Allow once with Face ID: a fresh challenge, a fresh signature, one answer. */
export async function allowWithFaceId(input: {
  readonly api: FaceIdApi;
  readonly signer: FaceIdSigner;
  readonly transport: MacTransport;
  readonly request: {
    readonly threadId: string;
    readonly requestId: string;
    readonly fingerprint: string;
  };
  readonly reason: string;
  readonly label?: string;
}): Promise<AllowOutcome> {
  const { api, signer, transport, request } = input;
  const label = input.label ?? "Face ID";
  const issued = await api.deviceKeyChallenge(transport, {
    threadId: request.threadId,
    requestId: request.requestId,
    fingerprint: request.fingerprint,
  });
  if (!issued.ok) {
    return KEY_REASONS.has(issued.reason)
      ? { kind: "use-code", note: null }
      : { kind: "problem", message: issued.message };
  }
  if (issued.value.keyId === null || issued.value.purpose !== "approve") {
    return { kind: "use-code", note: null };
  }
  let signature: string | undefined;
  try {
    [signature] = await signer.sign(input.reason, [
      { purpose: "approve", challenge: issued.value.challenge, action: issued.value.action },
    ]);
  } catch (error) {
    const code = deviceKeyErrorCode(error);
    // Face ID passed but the key refused: the enrolled faces changed and iOS voided the key
    // (biometryCurrentSet). It can never sign again, so this phone forgets it and shows Set up.
    if (code === "key-invalid") signer.remove();
    return { kind: "use-code", note: fallbackNote(code, label) };
  }
  if (typeof signature !== "string" || signature.length === 0) {
    return { kind: "use-code", note: fallbackNote("failed", label) };
  }
  const answered = await api.answerRequest(transport, {
    threadId: request.threadId,
    requestId: request.requestId,
    decision: "accept",
    fingerprint: request.fingerprint,
    proof: {
      type: "device-key",
      keyId: issued.value.keyId,
      challenge: issued.value.challenge,
      signature,
    },
  });
  if (answered.ok) return { kind: "allowed" };
  return KEY_REASONS.has(answered.reason)
    ? { kind: "use-code", note: answered.message }
    : { kind: "problem", message: answered.message };
}

/**
 * Set up once with the parent code, on every linked Mac: their challenges first (each checks
 * the code), then one key and one Face ID check for all of them, then each Mac keeps the key.
 * A plain sentence when it couldn't, for the code sheet; null when it worked.
 */
export async function setUpFaceId(input: {
  readonly api: FaceIdApi;
  readonly signer: FaceIdSigner;
  readonly macs: ReadonlyArray<FaceIdMac>;
  readonly code: string;
  readonly reason?: string;
  readonly label?: string;
}): Promise<string | null> {
  const label = input.label ?? "Face ID";
  if (input.macs.length === 0) return "Link this iPhone to your family's Mac first.";
  const challenges: Array<{
    readonly mac: FaceIdMac;
    readonly challenge: string;
    readonly action: string;
  }> = [];
  for (const mac of input.macs) {
    const options = await input.api.deviceKeyOptions(mac.transport, input.code);
    if (!options.ok) {
      return input.macs.length > 1 ? `${mac.macName}: ${options.message}` : options.message;
    }
    if (options.value.purpose !== "register")
      return `${label} didn't finish setting up. Try again.`;
    challenges.push({ mac, challenge: options.value.challenge, action: options.value.action });
  }
  let created: CreatedDeviceKey;
  try {
    created = await input.signer.create(
      input.reason ?? setUpReason(label),
      challenges.map(({ challenge, action }) => ({ purpose: "register", challenge, action })),
    );
  } catch (error) {
    const code = deviceKeyErrorCode(error);
    if (code === "cancelled" || code === "fallback") {
      return `${label} wasn't set up. Try again when you're ready.`;
    }
    if (code === "unavailable") {
      return `Turn on ${label} for this iPhone in Settings first, then try again.`;
    }
    return fallbackNote(code, label) ?? `${label} didn't finish setting up. Try again.`;
  }
  for (const [index, entry] of challenges.entries()) {
    const signature = created.signatures[index];
    const registered: FamilyResult<string> =
      typeof signature === "string"
        ? await input.api.deviceKeyRegister(entry.mac.transport, {
            challenge: entry.challenge,
            publicKey: created.publicKey,
            signature,
            biometry: created.biometry,
          })
        : { ok: false, reason: "failed", message: `${label} didn't finish setting up. Try again.` };
    if (!registered.ok) {
      return input.macs.length > 1
        ? `${entry.mac.macName}: ${registered.message}`
        : registered.message;
    }
  }
  return null;
}

/**
 * "Stop using Face ID": the key goes from this phone first (so it can never sign again, even
 * if a Mac is asleep), then each Mac forgets it. A sentence when a Mac didn't answer.
 */
export async function stopUsingFaceId(input: {
  readonly api: FaceIdApi;
  readonly signer: FaceIdSigner;
  readonly macs: ReadonlyArray<FaceIdMac>;
  readonly label?: string;
}): Promise<string | null> {
  const label = input.label ?? "Face ID";
  input.signer.remove();
  const missed: Array<string> = [];
  for (const mac of input.macs) {
    const result = await input.api.deviceKeyForget(mac.transport);
    if (!result.ok) missed.push(mac.macName);
  }
  if (missed.length === 0) return null;
  return `${label} is off on this iPhone. ${missed.join(" and ")} didn't answer, so it still shows ${label} for this iPhone until you try again; it can't be used.`;
}

/**
 * Whether Allow once on this Mac starts with Face ID: this phone has a key, Face ID works now,
 * and the Mac keeps this phone's key. Otherwise the parent code, as before.
 */
export function faceIdReadyOn(input: {
  readonly native: { readonly available: boolean; readonly hasKey: boolean } | null;
  readonly macKnowsKey: boolean;
}): boolean {
  return (
    input.native !== null && input.native.available && input.native.hasKey && input.macKnowsKey
  );
}
