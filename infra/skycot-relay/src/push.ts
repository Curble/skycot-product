// Notifications through Apple's push service (APNs), content-free by construction.
//
// - The Mac never holds a device's push token. The device gives its token to the relay, which
//   seals it into a *reference* only the relay can open (AES-256-GCM with the relay's own secret,
//   bound to the home), and the device hands that reference to its Mac through the tunnel.
// - The Mac asks for a notification with a reference and a *kind* only. The words are chosen
//   here from a fixed table, so no child's name, project or message can reach Apple or the relay.
// - An optional `sealed` field is passed through untouched for the iOS app's notification
//   extension (Phase 3) to open with its own key; the relay cannot read it.
// - Live Activities (Phase 3) get a phase only ("working", "done"): their content is shown by
//   the system without the app, so it must not need decrypting, and it stays content-free.

import {
  fromBase64Url,
  fromUtf8,
  parseJsonObject,
  toBase64Url,
  utf8,
} from "@t3tools/skycot-relay/encoding";
import type { ApnsEnvironment, PushKind, PushTokenType } from "@t3tools/skycot-relay/protocol";

export const ALERT_TEXT: Readonly<Record<PushKind, string | null>> = {
  "needs-grown-up": "SKYCOT needs a grown-up",
  finished: "Sam has finished",
  "activity-update": null,
  "activity-end": null,
};

/**
 * The iOS app's notification category for a kind: "needs-grown-up" gets the same Allow once and
 * Decline buttons as the app's own notification (SKYCOT_REQUEST in
 * apps/skycot-mobile/modules/skycot-watch). A fixed word, as content-free as the text.
 */
export const ALERT_CATEGORY: Readonly<Partial<Record<PushKind, string>>> = {
  "needs-grown-up": "SKYCOT_REQUEST",
};

export interface PushTarget {
  readonly token: string;
  readonly type: PushTokenType;
  readonly environment: ApnsEnvironment;
}

export interface PushEnv {
  /** 32 random bytes, base64url: seals push tokens into references. */
  readonly PUSH_REF_KEY?: string;
  readonly APNS_TEAM_ID?: string;
  readonly APNS_KEY_ID?: string;
  /** The .p8 key's contents (PEM). A secret; never in the repository. */
  readonly APNS_PRIVATE_KEY?: string;
  readonly APNS_BUNDLE_ID?: string;
  /** Local tests only: where to send instead of Apple. */
  readonly APNS_ORIGIN?: string;
}

const refAad = (homeId: string) => utf8(`skycot-relay/push-ref/v1|${homeId}`);

async function refKey(env: PushEnv): Promise<CryptoKey | null> {
  const raw = env.PUSH_REF_KEY === undefined ? null : fromBase64Url(env.PUSH_REF_KEY);
  if (raw === null || raw.length !== 32) return null;
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export const isPushToken = (token: string) => /^[0-9a-fA-F]{64,200}$/.test(token);

export async function sealPushRef(
  env: PushEnv,
  homeId: string,
  target: PushTarget,
): Promise<string | null> {
  const key = await refKey(env);
  if (key === null) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = utf8(
    JSON.stringify({ t: target.token, y: target.type, e: target.environment }),
  );
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: refAad(homeId) },
      key,
      plaintext,
    ),
  );
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return toBase64Url(out);
}

export async function openPushRef(
  env: PushEnv,
  homeId: string,
  ref: string,
): Promise<PushTarget | null> {
  const key = await refKey(env);
  const bytes = ref.length > 600 ? null : fromBase64Url(ref);
  if (key === null || bytes === null || bytes.length < 12 + 16) return null;
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: refAad(homeId) },
        key,
        bytes.subarray(12),
      ),
    );
  } catch {
    return null;
  }
  const value = parseJsonObject(fromUtf8(plaintext));
  const token = value?.["t"];
  const type = value?.["y"];
  const environment = value?.["e"];
  if (typeof token !== "string" || !isPushToken(token)) return null;
  if (type !== "alert" && type !== "liveactivity") return null;
  if (environment !== "production" && environment !== "development") return null;
  return { token, type, environment };
}

/** What goes to Apple for one kind: headers and a JSON body with nothing personal in it. */
export function apnsRequestFor(input: {
  readonly kind: PushKind;
  readonly target: PushTarget;
  readonly bundleId: string;
  readonly sealed: string | null;
  readonly nowSeconds: number;
}): { readonly headers: Record<string, string>; readonly body: string } | null {
  const { kind, target } = input;
  if (target.type === "alert") {
    const text = ALERT_TEXT[kind];
    if (text === null) return null;
    return {
      headers: {
        "apns-push-type": "alert",
        "apns-topic": input.bundleId,
        "apns-priority": "10",
        "apns-expiration": String(input.nowSeconds + 3600),
      },
      body: JSON.stringify({
        aps: {
          alert: { title: "SKYCOT", body: text },
          sound: "default",
          "mutable-content": 1,
          "thread-id": kind,
          ...(ALERT_CATEGORY[kind] === undefined ? {} : { category: ALERT_CATEGORY[kind] }),
        },
        ...(input.sealed === null ? {} : { s: input.sealed }),
      }),
    };
  }
  if (kind !== "activity-update" && kind !== "activity-end") return null;
  return {
    headers: {
      "apns-push-type": "liveactivity",
      "apns-topic": `${input.bundleId}.push-type.liveactivity`,
      "apns-priority": "10",
    },
    body: JSON.stringify({
      aps: {
        timestamp: input.nowSeconds,
        event: kind === "activity-end" ? "end" : "update",
        "content-state": { phase: kind === "activity-end" ? "done" : "working" },
        ...(kind === "activity-end" ? { "dismissal-date": input.nowSeconds + 15 * 60 } : {}),
      },
    }),
  };
}

let cachedJwt: {
  readonly value: string;
  readonly issuedAt: number;
  readonly keyId: string;
} | null = null;

function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> | null {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return fromBase64Url(base64);
}

/** Apple's provider token: ES256, reused for 40 minutes (Apple asks for 20 to 60). */
export async function apnsJwt(env: PushEnv, nowSeconds: number): Promise<string | null> {
  if (!env.APNS_TEAM_ID || !env.APNS_KEY_ID || !env.APNS_PRIVATE_KEY) return null;
  if (
    cachedJwt !== null &&
    cachedJwt.keyId === env.APNS_KEY_ID &&
    nowSeconds - cachedJwt.issuedAt < 40 * 60
  ) {
    return cachedJwt.value;
  }
  const der = pemToPkcs8(env.APNS_PRIVATE_KEY);
  if (der === null) return null;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = toBase64Url(utf8(JSON.stringify({ alg: "ES256", kid: env.APNS_KEY_ID })));
  const claims = toBase64Url(utf8(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: nowSeconds })));
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(`${header}.${claims}`)),
  );
  const value = `${header}.${claims}.${toBase64Url(signature)}`;
  cachedJwt = { value, issuedAt: nowSeconds, keyId: env.APNS_KEY_ID };
  return value;
}

export type PushOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export async function sendPush(input: {
  readonly env: PushEnv;
  readonly homeId: string;
  readonly ref: string;
  readonly kind: PushKind;
  readonly sealed: string | null;
  readonly nowSeconds: number;
}): Promise<PushOutcome> {
  const { env } = input;
  if (!env.APNS_BUNDLE_ID) return { ok: false, reason: "not-configured" };
  const target = await openPushRef(env, input.homeId, input.ref);
  if (target === null) return { ok: false, reason: "bad-ref" };
  const request = apnsRequestFor({
    kind: input.kind,
    target,
    bundleId: env.APNS_BUNDLE_ID,
    sealed: input.sealed,
    nowSeconds: input.nowSeconds,
  });
  if (request === null) return { ok: false, reason: "wrong-kind" };
  const jwt = await apnsJwt(env, input.nowSeconds);
  if (jwt === null) return { ok: false, reason: "not-configured" };
  const origin =
    env.APNS_ORIGIN ??
    (target.environment === "production"
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com");
  let response: Response;
  try {
    response = await fetch(`${origin}/3/device/${target.token}`, {
      method: "POST",
      headers: {
        ...request.headers,
        authorization: `bearer ${jwt}`,
        "content-type": "application/json",
      },
      body: request.body,
      redirect: "manual",
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (response.status === 200) return { ok: true };
  // 410: the app was removed or the token replaced; the Mac forgets the reference.
  return { ok: false, reason: response.status === 410 ? "gone" : `apns-${response.status}` };
}
