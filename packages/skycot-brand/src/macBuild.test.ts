import { describe, expect, it } from "vite-plus/test";

import {
  SKYCOT_MAC_ENTITLEMENTS_PLIST,
  SkycotConnectConfiguredError,
  SkycotConnectSettingError,
  rebrandMacInfoStrings,
  resolveSkycotMacSigning,
} from "./macBuild.ts";

describe("SKYCOT's signed Mac build", () => {
  it("leaves an unbranded build on upstream's passkey signing", () => {
    expect(resolveSkycotMacSigning({ T3CODE_CLERK_PUBLISHABLE_KEY: "pk_live_x" })).toBeUndefined();
  });

  it("signs without Clerk or a provisioning profile when Connect is off", () => {
    const signing = resolveSkycotMacSigning({ T3CODE_SKYCOT_CONNECT: "off" });
    expect(signing?.entitlementsPlist).toBe(SKYCOT_MAC_ENTITLEMENTS_PLIST);
    // Restricted entitlements kill a Developer ID app at launch without an embedded profile.
    for (const restricted of [
      "com.apple.application-identifier",
      "com.apple.developer.team-identifier",
      "com.apple.developer.associated-domains",
      "keychain-access-groups",
      "com.apple.developer.web-browser.public-key-credential",
    ]) {
      expect(SKYCOT_MAC_ENTITLEMENTS_PLIST).not.toContain(restricted);
    }
    expect(SKYCOT_MAC_ENTITLEMENTS_PLIST).toContain("com.apple.security.cs.allow-jit");
  });

  it("fails closed when any T3 Connect setting is present", () => {
    expect(() =>
      resolveSkycotMacSigning({
        T3CODE_SKYCOT_CONNECT: "off",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_live_x",
        T3CODE_MACOS_PROVISIONING_PROFILE: "profile.provisionprofile",
        T3CODE_RELAY_URL: "  ",
      }),
    ).toThrow(SkycotConnectConfiguredError);
    try {
      resolveSkycotMacSigning({ T3CODE_SKYCOT_CONNECT: "off", T3CODE_RELAY_URL: "https://r" });
    } catch (error) {
      expect((error as SkycotConnectConfiguredError).names).toEqual(["T3CODE_RELAY_URL"]);
    }
  });

  it("refuses any Connect setting other than off", () => {
    expect(() => resolveSkycotMacSigning({ T3CODE_SKYCOT_CONNECT: "on" })).toThrow(
      SkycotConnectSettingError,
    );
  });
});

describe("macOS strings people see", () => {
  const upstreamMac = {
    icon: "icon.icns",
    extendInfo: {
      NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac: true,
      NSCameraUsageDescription: "T3 Code lets commands use the camera.",
      CFBundleDocumentTypes: [{ CFBundleTypeName: "Web page" }],
    },
    protocols: [
      { name: "T3 Code", schemes: ["skycot", "skycot-dev"] },
      { name: "Web site URL", schemes: ["http", "https"], role: "Viewer" },
    ],
  };

  it("names the product in permission prompts and URL schemes", () => {
    const mac = rebrandMacInfoStrings(upstreamMac, "SKYCOT");
    expect(mac.extendInfo.NSCameraUsageDescription).toBe("SKYCOT lets commands use the camera.");
    expect(mac.extendInfo.NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac).toBe(true);
    expect(mac.protocols[0]).toEqual({ name: "SKYCOT", schemes: ["skycot", "skycot-dev"] });
    expect(mac.protocols[1]).toEqual(upstreamMac.protocols[1]);
    expect(mac.icon).toBe("icon.icns");
  });

  it("changes nothing for an unbranded build", () => {
    expect(rebrandMacInfoStrings(upstreamMac, undefined)).toBe(upstreamMac);
  });
});
