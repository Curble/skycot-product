/**
 * How a SKYCOT Mac build is signed and labelled, where it differs from T3 Code's.
 *
 * T3 Code's signed Mac build always signs for T3 Connect: it derives passkey (WebAuthn) domains
 * from the Clerk publishable key and embeds an Associated Domains provisioning profile, so a
 * signed build cannot even start without T3CODE_CLERK_PUBLISHABLE_KEY and
 * T3CODE_MACOS_PROVISIONING_PROFILE. SKYCOT has no T3 Connect (no Clerk account, no relay; see
 * docs/legal/GO-LIVE-CHECKLIST.md C6), so its signed build takes neither and fails closed if
 * any Connect setting is present: a Clerk key in a stray `.env` would otherwise switch on
 * sign-in to T3's service inside SKYCOT.
 *
 * The brand bootstrap (`nondev/brand/env.cjs`) sets `T3CODE_SKYCOT_CONNECT=off`. Without the
 * variable (an unbranded process) every function here returns "upstream's path" and changes
 * nothing. Read by `scripts/build-desktop-artifact.ts` (seams `skycot-mac-signing`,
 * `skycot-mac-info-strings`). Pure: no I/O.
 */

export const SKYCOT_CONNECT_ENV = "T3CODE_SKYCOT_CONNECT";

/** Settings that switch on T3 Connect (Clerk sign-in, the relay) or its passkey signing. */
export const T3_CONNECT_ENV_NAMES = [
  "T3CODE_CLERK_PUBLISHABLE_KEY",
  "VITE_CLERK_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "T3CODE_CLERK_JWT_TEMPLATE",
  "VITE_CLERK_JWT_TEMPLATE",
  "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID",
  "VITE_CLERK_CLI_OAUTH_CLIENT_ID",
  "T3CODE_CLERK_PASSKEY_RP_DOMAINS",
  "T3CODE_RELAY_URL",
  "VITE_T3CODE_RELAY_URL",
  "T3CODE_MACOS_PROVISIONING_PROFILE",
] as const;

/**
 * The hardened-runtime exceptions T3 Code's signed build claims, minus everything that needs a
 * provisioning profile (application identifier, team identifier, associated domains, keychain
 * groups, browser passkeys). macOS kills a Developer ID app at launch if it claims a restricted
 * entitlement that no embedded profile grants, so these are the only ones safe without one.
 * Keep in step with `renderMacPasskeyEntitlements` in scripts/build-desktop-artifact.ts.
 */
export const SKYCOT_MAC_ENTITLEMENTS_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <!-- Electron's V8 and the bundled Node engine. -->
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <!-- Native add-ons (node-pty, keyring, fff) are signed by the same team at build time,
         but provider CLIs load their own. -->
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <!-- Terminals and coding agents inherit the app's privacy identity: without these a
         command such as ffmpeg gets a silent access-denied for the camera or microphone. -->
    <key>com.apple.security.device.camera</key>
    <true/>
    <key>com.apple.security.device.audio-input</key>
    <true/>
  </dict>
</plist>
`;

export class SkycotConnectConfiguredError extends Error {
  readonly names: readonly string[];
  constructor(names: readonly string[]) {
    super(
      `SKYCOT has no T3 Connect, but ${names.join(", ")} ${names.length === 1 ? "is" : "are"} set ` +
        "(in the shell, the repo's .env or .env.local). Remove " +
        `${names.length === 1 ? "it" : "them"} and build again; a SKYCOT build never signs for ` +
        "T3's sign-in service.",
    );
    this.name = "SkycotConnectConfiguredError";
    this.names = names;
  }
}

export class SkycotConnectSettingError extends Error {
  constructor(value: string) {
    super(`${SKYCOT_CONNECT_ENV} must be "off" (SKYCOT has no T3 Connect), not "${value}".`);
    this.name = "SkycotConnectSettingError";
  }
}

export interface SkycotMacSigning {
  /** Written to the staged app and handed to electron-builder as `mac.entitlements`. */
  readonly entitlementsPlist: string;
}

/**
 * `undefined` for an unbranded process (take upstream's passkey signing). For SKYCOT: sign
 * with the Developer ID identity and `SKYCOT_MAC_ENTITLEMENTS_PLIST`, no provisioning profile,
 * no Clerk; throws if any T3 Connect setting is present.
 */
export function resolveSkycotMacSigning(
  env: Readonly<Record<string, string | undefined>>,
): SkycotMacSigning | undefined {
  const setting = env[SKYCOT_CONNECT_ENV];
  if (setting === undefined) return undefined;
  if (setting.trim().toLowerCase() !== "off") throw new SkycotConnectSettingError(setting);
  const configured = T3_CONNECT_ENV_NAMES.filter((name) => (env[name]?.trim() ?? "") !== "");
  if (configured.length > 0) throw new SkycotConnectConfiguredError(configured);
  return { entitlementsPlist: SKYCOT_MAC_ENTITLEMENTS_PLIST };
}

const UPSTREAM_NAME = "T3 Code";

/**
 * Replaces upstream's product name in the strings macOS shows people: the camera, microphone,
 * local-network and screen-recording permission prompts (Info.plist usage descriptions) and the
 * URL-scheme names. Returns a new mac config; `productName` undefined (unbranded) returns the
 * input unchanged.
 */
export function rebrandMacInfoStrings<T>(macConfig: T, productName: string | undefined): T {
  if (productName === undefined || productName.trim() === "" || productName === UPSTREAM_NAME) {
    return macConfig;
  }
  const rename = (value: unknown): unknown => {
    if (typeof value === "string") return value.replaceAll(UPSTREAM_NAME, productName);
    if (Array.isArray(value)) return value.map(rename);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rename(item)]));
    }
    return value;
  };
  if (macConfig === null || typeof macConfig !== "object") return macConfig;
  const config = macConfig as Record<string, unknown>;
  return {
    ...config,
    ...(config.extendInfo !== undefined ? { extendInfo: rename(config.extendInfo) } : {}),
    ...(Array.isArray(config.protocols)
      ? {
          protocols: config.protocols.map((protocol: unknown) =>
            protocol !== null && typeof protocol === "object" && "name" in protocol
              ? { ...protocol, name: rename((protocol as { name: unknown }).name) }
              : protocol,
          ),
        }
      : {}),
  } as T;
}
