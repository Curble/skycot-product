/**
 * SKYCOT for iPhone and iPad: the Expo app config.
 *
 * Forked from apps/mobile/app.config.ts (T3 Code, MIT). Everything that pointed at T3 Tools is
 * gone: no Expo/EAS owner or project id, no update URL, no Clerk, no T3 Connect relay, no Axiom
 * traces, no associated domains, no App Store id. `nondev/scripts/t3-address-guard.ts` checks
 * this folder so none can come back unnoticed.
 *
 * Apple: SKYCOT's team is 3F72LCWGG2. Nothing here creates an app record, certificate or
 * profile; Simulator builds need none (see README.md, "What needs Mark").
 */
import type { ExpoConfig } from "expo/config";

type AppVariant = "development" | "production";

const APP_VARIANT: AppVariant =
  process.env.APP_VARIANT === "development" ? "development" : "production";

/** SKYCOT's Apple Developer team (Curble Pty Ltd). Signing only; no account step runs here. */
export const SKYCOT_APPLE_TEAM_ID = "3F72LCWGG2";

const brandAsset = (relative: string) => `../../nondev/brand/assets/${relative}`;

const ICONS = {
  // The day icon is the everyday one; iOS 18+ shows the dusk-coloured one in dark mode and
  // tints the monochrome one, the way the website switches day and dusk.
  light: brandAsset("ios-android/ios/AppIcon.appiconset/AppIcon-day-1024.png"),
  dark: brandAsset("ios-android/ios/AppIcon.appiconset/AppIcon-dark-1024.png"),
  tinted: brandAsset("ios-android/ios/AppIcon.appiconset/AppIcon-tinted-1024.png"),
} as const;

const VARIANT_CONFIG = {
  development: {
    appName: "SKYCOT Dev",
    scheme: "skycot-dev",
    iosBundleIdentifier: "com.skycot.app.ios.dev",
    // Apple's sandbox push service: the dev app runs from Xcode with a development profile.
    apsEnvironment: "development",
  },
  production: {
    appName: "SKYCOT",
    // Not "skycot": the unrelated "SKYCOT Merchant" app on the same phone claims it, and iOS
    // opened that app from our notifications (TestFlight build 4, 24 Oct 2026).
    scheme: "skycot-family",
    iosBundleIdentifier: "com.skycot.app.ios",
    // TestFlight and the App Store use Apple's production push service.
    apsEnvironment: "production",
  },
} as const;

const variant = VARIANT_CONFIG[APP_VARIANT];

const widgetsPlugin: NonNullable<ExpoConfig["plugins"]>[number] = [
  "expo-widgets",
  {
    bundleIdentifier: `${variant.iosBundleIdentifier}.widgets`,
    groupIdentifier: `group.${variant.iosBundleIdentifier}`,
    // Widget (Live Activity) pushes are not used yet: the app updates both from local state.
    // Ordinary notifications get their own entitlement below (ios.entitlements).
    enablePushNotifications: false,
    frequentUpdates: true,
    enableAndroid: false,
    widgets: [
      {
        name: "FamilyStatus",
        displayName: "SKYCOT",
        description: "Whether Sam is building, or a child needs a grown-up.",
        android: null,
        ios: { supportedFamilies: ["systemSmall", "systemMedium", "accessoryRectangular"] },
      },
      {
        name: "AgentActivity",
        displayName: "SKYCOT is building",
        description: "Shows when Sam is building or someone needs a grown-up.",
        android: null,
        ios: { supportedFamilies: ["systemSmall", "systemMedium", "accessoryRectangular"] },
      },
    ],
  },
];

const config: ExpoConfig = {
  name: variant.appName,
  slug: "skycot",
  platforms: ["ios"],
  scheme: variant.scheme,
  version: process.env.SKYCOT_MOBILE_VERSION ?? "0.1.0",
  orientation: "default",
  icon: ICONS.light,
  userInterfaceStyle: "automatic",
  // No over-the-air updates: the app only ever runs the code Apple reviewed.
  updates: { enabled: false },
  ios: {
    icon: ICONS,
    supportsTablet: true,
    bundleIdentifier: variant.iosBundleIdentifier,
    appleTeamId: SKYCOT_APPLE_TEAM_ID,
    // Each upload to App Store Connect needs a new build number (TestFlight 0.1.0: 1 failed
    // processing, 2 the first TestFlight build, 3 the first with notifications, 4 the first
    // with Face ID to say yes).
    buildNumber: process.env.SKYCOT_MOBILE_BUILD ?? "5",
    // "SKYCOT needs a grown-up" and "Sam has finished" from SKYCOT Relay, also when the app is
    // closed (iOS forwards them to a paired Apple Watch). The pushes are content-free and shown
    // by iOS itself, so no background mode is needed (UIBackgroundModes stays unset).
    entitlements: { "aps-environment": variant.apsEnvironment },
    infoPlist: {
      CFBundleDisplayName: variant.appName,
      // SKYCOT has no call site for the photo library (audited 29 Oct 2026, C11). The sentence stays
      // only because Expo's file-system module (part of expo itself) has a photo-copy function, so
      // Apple's scan requires it (upload error 90683). It says plainly that SKYCOT does not use it.
      NSPhotoLibraryUsageDescription:
        "SKYCOT does not use your photos and never looks through them. Apple asks every app that includes this toolkit to say so.",
      UISupportedInterfaceOrientations: [
        "UIInterfaceOrientationPortrait",
        "UIInterfaceOrientationLandscapeLeft",
        "UIInterfaceOrientationLandscapeRight",
      ],
      "UISupportedInterfaceOrientations~ipad": [
        "UIInterfaceOrientationPortrait",
        "UIInterfaceOrientationPortraitUpsideDown",
        "UIInterfaceOrientationLandscapeLeft",
        "UIInterfaceOrientationLandscapeRight",
      ],
      // The family's Mac answers over the home Wi-Fi or Tailscale, often on plain http. Every
      // address the app opens is one a grown-up linked at the Mac (see src/transport).
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true },
      NSLocalNetworkUsageDescription:
        "SKYCOT talks to your family's Mac over your home Wi-Fi, so you can see and guide what your child is building. It does not scan for other devices.",
      NSSpeechRecognitionUsageDescription:
        "SKYCOT turns your child's spoken idea into words on this device, so they can say it instead of typing it. The words are not sent to Apple or anyone else.",
      NSSupportsLiveActivities: true,
      // Face ID to say yes on a grown-up's phone (modules/skycot-device-key): the Secure Enclave
      // key signs a yes only after Face ID, so iOS asks once whether SKYCOT may use it.
      NSFaceIDUsageDescription:
        "SKYCOT uses Face ID so only you can say yes to your child's request. Your face is checked by iPhone and never reaches SKYCOT.",
      // Export compliance (24 October 2026): Mark answered App Store Connect's questions for builds
      // 2 and 3 (standard encryption in addition to Apple's — the relay's Noise tunnel — and not
      // distributed in France), and Apple then said the build needs no encryption documentation and
      // that this key may say so, so later builds skip the "Missing Compliance" stop. Revisit if
      // France or non-standard encryption ever comes in.
      ITSAppUsesNonExemptEncryption: false,
    },
    // The iPhone app's own privacy manifest, made at prebuild (React Native's pod install adds
    // the reasons its libraries need). Declared here so it exists before the Watch app's own
    // manifest (watch/SkycotWatch/PrivacyInfo.xcprivacy) joins the project; otherwise React
    // Native's tooling would pick the Watch's file for the iPhone app.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [],
    },
  },
  plugins: [
    "expo-asset",
    "expo-secure-store",
    [
      "expo-camera",
      {
        cameraPermission:
          "SKYCOT uses the camera only to scan the code shown on your family's Mac. Nothing is recorded or saved.",
        // The microphone sentence lives here, not in infoPlist: this plugin writes
        // NSMicrophoneUsageDescription itself, and `false` made it delete the key, so the
        // speech button (modules/skycot-speech) would have had no sentence to show (C11, 29 Oct).
        microphonePermission:
          "SKYCOT uses the microphone so your child can say their idea out loud instead of typing it, when a grown-up has turned talking on. Nothing is recorded or kept.",
        barcodeScannerEnabled: true,
        recordAudioAndroid: false,
      },
    ],
    [
      "expo-splash-screen",
      {
        // SKYCOT waving: the day pose on cream in light mode, dusk on midnight in dark mode.
        image: brandAsset("poses/day/mascot-hello-day-512.png"),
        resizeMode: "contain",
        backgroundColor: "#FFF6E6",
        imageWidth: 180,
        dark: {
          image: brandAsset("poses/dusk/mascot-hello-dusk-512.png"),
          backgroundColor: "#171A45",
        },
      },
    ],
    // nondev-seam: skycot-ios17-deployment-target
    ["expo-build-properties", { ios: { deploymentTarget: "17.0" } }],
    // Must stay BEFORE expo-widgets (see the plugin's own comment).
    "./plugins/withWidgetMarkAsset.cjs",
    widgetsPlugin,
    // SKYCOT on a grown-up's Apple Watch (Phase 4): the SwiftUI Watch app in watch/SkycotWatch,
    // bundle id `<this app's id>.watchkitapp`, embedded in this app.
    "./plugins/withSkycotWatch.cjs",
  ],
  extra: {
    appVariant: APP_VARIANT,
    upstreamCredit: "Based on T3 Code (MIT) by T3 Tools Inc.",
    copyright: "Copyright © 2026 Curble Pty Ltd, trading as SKYCOT.",
  },
};

export default config;
