/**
 * Face ID to say yes on a grown-up's phone: what this phone's Secure Enclave key and each linked
 * Mac know, and the three things a screen can do (set up, allow once, stop). The steps are in
 * faceId.ts; the key is modules/skycot-device-key. A child's device never has any of this: the
 * provider is off unless this device is a grown-up's, and the Mac refuses a child's device too.
 */
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";

import { SkycotDeviceKey, type DeviceKeyStatus } from "../../modules/skycot-device-key";
import { useMacData } from "../data/MacData";
import { familyApi } from "../family/api";
import { useLinks, type Mac } from "../links/store";
import {
  allowReason,
  allowWithFaceId,
  biometryLabel,
  faceIdReadyOn,
  setUpFaceId,
  stopUsingFaceId,
  type AllowOutcome,
} from "./faceId";

// nondev-seam: skycot-mobile-project-approval-faceid-provider
interface FaceIdValue {
  /** What the Secure Enclave says, or null where there is no Face ID key at all. */
  readonly native: DeviceKeyStatus | null;
  /** "Face ID", or "Touch ID" on an iPad. */
  readonly label: string;
  /** Allow once on this Mac starts with Face ID. */
  readonly readyOn: (mac: Mac) => boolean;
  /** Set up on every linked Mac. */
  readonly everywhere: boolean;
  readonly setUp: (code: string) => Promise<string | null>;
  readonly stop: () => Promise<string | null>;
  readonly allow: (
    mac: Mac,
    request: {
      readonly threadId: string;
      readonly requestId: string;
      readonly fingerprint: string;
    },
    childName: string | null,
    scope?: "once" | "project",
  ) => Promise<AllowOutcome>;
}

const OFF: FaceIdValue = {
  native: null,
  label: "Face ID",
  readyOn: () => false,
  everywhere: false,
  setUp: async () => "Face ID isn't available here.",
  stop: async () => null,
  allow: async () => ({ kind: "use-code", note: null }),
};

const FaceIdContext = createContext<FaceIdValue>(OFF);

export function useFaceId(): FaceIdValue {
  return use(FaceIdContext);
}

const readNative = (): DeviceKeyStatus | null => {
  try {
    return SkycotDeviceKey?.status() ?? null;
  } catch {
    return null;
  }
};

export function FaceIdProvider(props: { readonly children: ReactNode }) {
  const { macs, mode } = useLinks();
  const { byMac, refresh } = useMacData();
  const [native, setNative] = useState<DeviceKeyStatus | null>(readNative);

  // Face ID can be turned off, or faces changed, in Settings while SKYCOT is in the background.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setNative(readNative());
    });
    return () => subscription.remove();
  }, []);

  const macKnowsKey = useCallback(
    (mac: Mac): boolean =>
      (byMac[mac.macId]?.status?.devices ?? []).some(
        (device) => device.id === mac.me.deviceId && device.faceId,
      ),
    [byMac],
  );

  const value = useMemo<FaceIdValue>(() => {
    if (mode !== "grown-up" || SkycotDeviceKey === null) return OFF;
    const signer = SkycotDeviceKey;
    const label = biometryLabel(native?.biometry);
    const readyOn = (mac: Mac) => faceIdReadyOn({ native, macKnowsKey: macKnowsKey(mac) });
    return {
      native,
      label,
      readyOn,
      everywhere: macs.length > 0 && macs.every(readyOn),
      setUp: async (code) => {
        const problem = await setUpFaceId({ api: familyApi, signer, macs, code, label });
        setNative(readNative());
        await Promise.all(macs.map((mac) => refresh(mac.macId)));
        return problem;
      },
      stop: async () => {
        const problem = await stopUsingFaceId({ api: familyApi, signer, macs, label });
        setNative(readNative());
        await Promise.all(macs.map((mac) => refresh(mac.macId)));
        return problem;
      },
      allow: async (mac, request, childName, scope = "once") => {
        const outcome = await allowWithFaceId({
          api: familyApi,
          signer,
          transport: mac.transport,
          request,
          scope,
          reason: allowReason(childName),
          label,
        });
        // A key Face ID no longer opens shows as not set up from now on.
        setNative(readNative());
        return outcome;
      },
    };
  }, [mode, native, macs, macKnowsKey, refresh]);

  return <FaceIdContext value={value}>{props.children}</FaceIdContext>;
}
