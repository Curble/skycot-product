import { afterEach, describe, expect, it, vi } from "vite-plus/test";

type Config = typeof import("../../app.config").default;

/** The app config as a build with SKYCOT_MOBILE_CHILD_MODE set (or unset) would produce it. */
async function configFor(flag: string | undefined, variant = "production"): Promise<Config> {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  if (flag === undefined) vi.stubEnv("SKYCOT_MOBILE_CHILD_MODE", "");
  else vi.stubEnv("SKYCOT_MOBILE_CHILD_MODE", flag);
  return (await import("../../app.config")).default;
}

/** What expo-camera and the plist together write into Info.plist at prebuild. */
function purposeStrings(config: Config): Record<string, string> {
  const plist = { ...(config.ios?.infoPlist ?? {}) } as Record<string, unknown>;
  const camera = config.plugins?.find((p) => Array.isArray(p) && p[0] === "expo-camera") as
    | [string, { cameraPermission: string; microphonePermission: string | false }]
    | undefined;
  plist["NSCameraUsageDescription"] = camera?.[1].cameraPermission;
  // `false` is how the plugin is told to leave the microphone key out.
  if (camera?.[1].microphonePermission)
    plist["NSMicrophoneUsageDescription"] = camera[1].microphonePermission;
  return Object.fromEntries(
    Object.entries(plist).filter(
      ([key]) => /^NS.*UsageDescription$/.test(key) && typeof plist[key] === "string",
    ),
  ) as Record<string, string>;
}

describe("Privacy purpose strings (C11)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("grown-up-only build (flag off): no speech and no microphone sentence", async () => {
    const config = await configFor(undefined);
    expect(config.extra?.childMode).toBe(false);
    expect(Object.keys(purposeStrings(config)).toSorted()).toEqual([
      "NSCameraUsageDescription",
      "NSFaceIDUsageDescription",
      "NSLocalNetworkUsageDescription",
      "NSPhotoLibraryUsageDescription",
    ]);
  });

  it("child-mode build (flag on): adds the speech and microphone sentences", async () => {
    const config = await configFor("1");
    expect(config.extra?.childMode).toBe(true);
    expect(Object.keys(purposeStrings(config)).toSorted()).toEqual([
      "NSCameraUsageDescription",
      "NSFaceIDUsageDescription",
      "NSLocalNetworkUsageDescription",
      "NSMicrophoneUsageDescription",
      "NSPhotoLibraryUsageDescription",
      "NSSpeechRecognitionUsageDescription",
    ]);
  });

  it.each([undefined, "1"])("gives each a full, plain sentence (flag %s)", async (flag) => {
    const strings = purposeStrings(await configFor(flag));
    for (const [key, text] of Object.entries(strings)) {
      expect(text.length, key).toBeGreaterThan(40);
      expect(text, key).toMatch(/^SKYCOT /);
      expect(text, key).toMatch(/\.$/);
    }
  });
});
