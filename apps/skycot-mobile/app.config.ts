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
  },
  production: {
    appName: "SKYCOT",
    scheme: "skycot",
    iosBundleIdentifier: "com.skycot.app.ios",
  },
} as const;

const variant = VARIANT_CONFIG[APP_VARIANT];

const widgetsPlugin: NonNullable<ExpoConfig["plugins"]>[number] = [
  "expo-widgets",
  {
    bundleIdentifier: `${variant.iosBundleIdentifier}.widgets`,
    groupIdentifier: `group.${variant.iosBundleIdentifier}`,
    // Real pushes wait for SKYCOT Relay (Phase 2). The app updates both from local state.
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
  orientation: "portrait",
  icon: ICONS.light,
  userInterfaceStyle: "automatic",
  // No over-the-air updates: the app only ever runs the code Apple reviewed.
  updates: { enabled: false },
  ios: {
    icon: ICONS,
    supportsTablet: true,
    bundleIdentifier: variant.iosBundleIdentifier,
    appleTeamId: SKYCOT_APPLE_TEAM_ID,
    infoPlist: {
      CFBundleDisplayName: variant.appName,
      UISupportedInterfaceOrientations: ["UIInterfaceOrientationPortrait"],
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
        "SKYCOT talks to your family's Mac over your home Wi-Fi. Nothing goes anywhere else.",
      NSSpeechRecognitionUsageDescription:
        "Lets you talk instead of type. Your voice is turned into words on this device and is never sent anywhere.",
      NSMicrophoneUsageDescription:
        "Lets you talk instead of type, when a grown-up has turned talking on.",
      NSSupportsLiveActivities: true,
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    "expo-asset",
    "expo-secure-store",
    [
      "expo-camera",
      {
        cameraPermission: "SKYCOT uses the camera to scan the code on your family's Mac.",
        microphonePermission: false,
        barcodeScannerEnabled: true,
        recordAudioAndroid: false,
      },
    ],
    [
      "expo-splash-screen",
      {
        // Day on cream in light mode, dusk on midnight in dark mode, like skycot.com.
        image: brandAsset("ios-android/ios/AppIcon.appiconset/AppIcon-day-1024.png"),
        resizeMode: "contain",
        backgroundColor: "#FFF6E6",
        imageWidth: 160,
        dark: {
          image: brandAsset("ios-android/ios/AppIcon.appiconset/AppIcon-dark-1024.png"),
          backgroundColor: "#171A45",
        },
      },
    ],
    ["expo-build-properties", { ios: { deploymentTarget: "18.0" } }],
    // Must stay BEFORE expo-widgets (see the plugin's own comment).
    "./plugins/withWidgetMarkAsset.cjs",
    widgetsPlugin,
  ],
  extra: {
    appVariant: APP_VARIANT,
    upstreamCredit: "Based on T3 Code (MIT) by T3 Tools Inc.",
    copyright: "Copyright © 2026 Curble Pty Ltd, trading as SKYCOT.",
  },
};

export default config;
