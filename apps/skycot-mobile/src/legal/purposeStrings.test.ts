import { describe, expect, it } from "vite-plus/test";

import config from "../../app.config";

describe("Privacy purpose strings (C11)", () => {
  const plist = (config.ios?.infoPlist ?? {}) as Record<string, unknown>;
  // expo-camera writes the camera and microphone sentences into Info.plist at prebuild.
  const camera = config.plugins?.find((p) => Array.isArray(p) && p[0] === "expo-camera") as
    | [string, { cameraPermission: string; microphonePermission: string }]
    | undefined;
  plist["NSCameraUsageDescription"] = camera?.[1].cameraPermission;
  plist["NSMicrophoneUsageDescription"] = camera?.[1].microphonePermission;
  const keys = Object.keys(plist).filter((k) => /^NS.*UsageDescription$/.test(k));

  it("declares only the capabilities the app uses", () => {
    expect(keys.toSorted()).toEqual([
      "NSCameraUsageDescription",
      "NSFaceIDUsageDescription",
      "NSLocalNetworkUsageDescription",
      "NSMicrophoneUsageDescription",
      "NSPhotoLibraryUsageDescription",
      "NSSpeechRecognitionUsageDescription",
    ]);
  });

  it("gives each a full, plain sentence", () => {
    for (const key of keys) {
      const text = String(plist[key]);
      expect(text.length, key).toBeGreaterThan(40);
      expect(text, key).toMatch(/^SKYCOT /);
      expect(text, key).toMatch(/\.$/);
    }
  });
});
