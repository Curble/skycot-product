/**
 * SKYCOT's Face ID key on a grown-up's iPhone (ios/SkycotDeviceKeyModule.swift): a P-256 key in
 * the Secure Enclave that signs only after Face ID (or Touch ID) for that one signature, and that
 * iOS voids if the enrolled faces or fingers change. The module signs only SKYCOT's own
 * four-line message (`deviceKeySignedMessage`), built natively from the parts. Absent (null) on
 * anything but iOS; see src/faceid/.
 */
import { requireOptionalNativeModule } from "expo";

export type DeviceKeyBiometry = "face-id" | "touch-id" | "optic-id";

export interface DeviceKeyStatus {
  /** A Secure Enclave and an enrolled face or finger: a key can be made and used. */
  readonly available: boolean;
  readonly biometry: DeviceKeyBiometry | "none";
  /** A key was made on this device (it may still be refused if Face ID changed since). */
  readonly hasKey: boolean;
}

export interface SignRequest {
  readonly purpose: "register" | "approve";
  readonly challenge: string;
  readonly action: string;
}

export interface CreatedDeviceKey {
  /** SPKI DER, base64url: what the Mac keeps. */
  readonly publicKey: string;
  readonly biometry: DeviceKeyBiometry;
  /** ECDSA DER, base64url, one per request, in order. */
  readonly signatures: ReadonlyArray<string>;
}

/** The codes a rejected `create` or `sign` carries (its `code`). */
export type DeviceKeyErrorCode =
  | "cancelled"
  | "fallback"
  | "unavailable"
  | "locked-out"
  | "no-key"
  | "key-invalid"
  | "failed";

export interface SkycotDeviceKeyNative {
  status(): DeviceKeyStatus;
  create(reason: string, requests: ReadonlyArray<SignRequest>): Promise<CreatedDeviceKey>;
  sign(reason: string, requests: ReadonlyArray<SignRequest>): Promise<ReadonlyArray<string>>;
  remove(): void;
}

export const SkycotDeviceKey =
  requireOptionalNativeModule<SkycotDeviceKeyNative>("SkycotDeviceKey");
