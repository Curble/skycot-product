// The engine's Family profile over HTTP (`/api/skycot/family/*`). Same credentials as every
// other request this client makes: the browser session cookie when the page came from the
// engine, the desktop's bearer token otherwise. Every failure comes back as one plain sentence.
import { readDesktopPrimaryBearerToken } from "~/environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary/target";

import { parseSessionLimits, type SessionLimits } from "../family-limits/limits";
import type { ChildAvatar, ChildLimits, ChildVoice } from "./children";
import {
  ENGINE_UNREACHABLE,
  parseServerStatus,
  readFamilyAnswer,
  type FamilyPurpose,
  type FamilyResult,
  type ServerFamilyStatus,
} from "./family";

export const FAMILY_API_PATH = "/api/skycot/family";

async function call(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<Response> {
  return callEngine(method, `${FAMILY_API_PATH}${path}`, body, query);
}

/** One request to the engine's own HTTP API (`/api/...`), with this client's credentials. */
export async function callEngine(
  method: "GET" | "POST",
  fullPath: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<Response> {
  // The query goes separately: the path is set as a URL's pathname, which would escape a "?".
  const url = resolvePrimaryEnvironmentHttpUrl(fullPath, query);
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

export function request<A>(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  decode: (body: unknown) => A | null,
  query?: Record<string, string>,
): Promise<FamilyResult<A>> {
  return engineRequest(method, `${FAMILY_API_PATH}${path}`, body, decode, query);
}

/** Any SKYCOT engine route (`/api/skycot/…`), with the same credentials and plain answers. */
export async function engineRequest<A>(
  method: "GET" | "POST",
  fullPath: string,
  body: unknown,
  decode: (body: unknown) => A | null,
  query?: Record<string, string>,
): Promise<FamilyResult<A>> {
  try {
    const response = await call(method, fullPath, body, query);
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

/** What a parent sets for a child; fields left out keep their value. */
export interface ChildPatch {
  readonly name?: string | null;
  readonly avatar?: ChildAvatar;
  readonly look?: string;
  readonly largerText?: boolean;
  readonly voice?: Partial<ChildVoice>;
  readonly limits?: Partial<ChildLimits>;
}

function parseAdded(body: unknown) {
  const status = parseServerStatus(body);
  const childId =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>)["childId"] : null;
  return status === null || typeof childId !== "string" ? null : { status, childId };
}

/** The household's zone travels with every change a parent makes, so bedtimes read right. */
function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export const familyApi = {
  status: () => request("GET", "", undefined, parseServerStatus),
  enable: (input: { readonly code: string; readonly childName: string | null }) =>
    request("POST", "/enable", { ...input, timeZone: browserZone() }, parseServerStatus),
  addChild: (child: ChildPatch) =>
    request("POST", "/children/add", { child, timeZone: browserZone() }, parseAdded),
  updateChild: (input: { readonly childId: string; readonly patch: ChildPatch }) =>
    request("POST", "/children/update", { ...input, timeZone: browserZone() }, parseServerStatus),
  removeChild: (input: { readonly childId: string }) =>
    request("POST", "/children/remove", input, parseServerStatus),
  look: (input: { readonly look?: string; readonly largerText?: boolean }) =>
    request("POST", "/look", input, parseServerStatus),
  choose: (input: { readonly childId: string }) =>
    request("POST", "/choose", input, parseSessionLimits),
  heartbeat: (input: { readonly active: boolean }) =>
    request("POST", "/heartbeat", input, parseSessionLimits),
  moreTime: (input: {
    readonly childId: string;
    readonly kind: "extra15" | "extra30" | "endBedtime";
    readonly code: string;
  }) => request("POST", "/more-time", input, parseSessionLimits),
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

export type { FamilyResult, ServerFamilyStatus, SessionLimits };
