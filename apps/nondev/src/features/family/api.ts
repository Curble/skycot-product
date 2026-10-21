// The engine's Family profile over HTTP (`/api/skycot/family/*`). Same credentials as every
// other request this client makes: the browser session cookie when the page came from the
// engine, the desktop's bearer token otherwise. Every failure comes back as one plain sentence.
import { readDesktopPrimaryBearerToken } from "~/environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary/target";

import {
  ENGINE_UNREACHABLE,
  parseServerStatus,
  readFamilyAnswer,
  type FamilyPurpose,
  type FamilyResult,
  type ServerFamilyStatus,
} from "./family";

export const FAMILY_API_PATH = "/api/skycot/family";

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
  const url = resolvePrimaryEnvironmentHttpUrl(`${FAMILY_API_PATH}${path}`);
  const sameOrigin =
    typeof window !== "undefined" &&
    window.desktopBridge === undefined &&
    new URL(url).origin === window.location.origin;
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (!sameOrigin) {
    const token = await readDesktopPrimaryBearerToken();
    if (token) headers["authorization"] = `Bearer ${token}`;
  }
  return fetch(url, {
    method,
    headers,
    credentials: sameOrigin ? "include" : "omit",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function request<A>(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  decode: (body: unknown) => A | null,
): Promise<FamilyResult<A>> {
  try {
    const response = await call(method, path, body);
    const parsed: unknown = await response.json().catch(() => null);
    return readFamilyAnswer(response.status, parsed, decode);
  } catch {
    return { ok: false, reason: "unreachable", message: ENGINE_UNREACHABLE };
  }
}

export interface UnlockToken {
  readonly token: string;
  readonly expiresAt: number;
  readonly purpose: FamilyPurpose;
}

function parseUnlock(body: unknown): UnlockToken | null {
  const record =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  if (record === null) return null;
  return typeof record["token"] === "string" && typeof record["expiresAt"] === "number"
    ? {
        token: record["token"],
        expiresAt: record["expiresAt"],
        purpose: record["purpose"] as FamilyPurpose,
      }
    : null;
}

export const familyApi = {
  status: () => request("GET", "", undefined, parseServerStatus),
  enable: (input: { readonly code: string; readonly childName: string | null }) =>
    request("POST", "/enable", input, parseServerStatus),
  verify: (input: {
    readonly code: string;
    readonly purpose: FamilyPurpose;
    readonly requestId?: string;
  }) => request("POST", "/verify", input, parseUnlock),
  disable: (input: { readonly code: string }) =>
    request("POST", "/disable", input, parseServerStatus),
  changeCode: (input: { readonly oldCode: string; readonly newCode: string }) =>
    request("POST", "/change-code", input, parseServerStatus),
  rename: (input: { readonly childName: string | null }) =>
    request("POST", "/rename", input, parseServerStatus),
  lock: () => request("POST", "/lock", {}, parseServerStatus),
} satisfies Record<string, (...args: never[]) => Promise<FamilyResult<unknown>>>;

export type { FamilyResult, ServerFamilyStatus };
