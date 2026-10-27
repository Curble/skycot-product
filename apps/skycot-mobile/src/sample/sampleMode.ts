/**
 * Entering and leaving the sample family, as plain functions the link store uses. The sample is
 * one extra, in-memory "Mac" (never saved to the keychain, never sent anywhere); while it is on,
 * it is the only Mac the screens see, and leaving drops it with everything it held.
 */
import type { Mac } from "../links/store";
import {
  SAMPLE_FAMILY_NAME,
  SAMPLE_GROWN_UP_ID,
  AVA,
  sampleMacId,
  type SampleWho,
} from "./fixtures";
import { createSampleTransport } from "./sampleTransport";

/** The sample is offered only to a device with no real Mac: it never hides a real link. */
export const canEnterSample = (realMacCount: number): boolean => realMacCount === 0;

export function createSampleMac(who: SampleWho, clock: () => number = Date.now): Mac {
  const now = clock();
  return {
    macId: sampleMacId(who),
    macName: SAMPLE_FAMILY_NAME,
    httpBaseUrl: null,
    me:
      who === "grown-up"
        ? {
            kind: "grown-up",
            deviceId: "sample-phone",
            deviceName: "Sample iPhone",
            personId: SAMPLE_GROWN_UP_ID,
          }
        : { kind: "child", deviceId: "sample-ipad", deviceName: "Sample iPad", childId: AVA },
    linkedAt: now,
    bearerToken: "",
    relayRecord: null,
    relay: null,
    transport: createSampleTransport(who, () => now),
    sample: true,
  };
}

/** What the screens see: the sample alone while it is on, else the really linked Macs. */
export const macsToShow = (real: ReadonlyArray<Mac>, sample: Mac | null): ReadonlyArray<Mac> =>
  sample === null ? real : [sample];

export const isSampleMac = (mac: { readonly sample?: boolean }): boolean => mac.sample === true;
