// The engine's Family profile over HTTP (`/api/skycot/family/*`). Same credentials as every
// other request this client makes: the browser session cookie when the page came from the
// engine, the desktop's bearer token otherwise. Every failure comes back as one plain sentence.
import { readDesktopPrimaryBearerToken } from "~/environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary/target";

import { readUnlockProof } from "./unlockProof";
import { parseSessionLimits, type SessionLimits } from "../family-limits/limits";
import type { ChildAvatar, ChildLimits, ChildVoice, ReadingLevel } from "./children";
import { parseDeviceLink, parseDeviceRows, parsePendingRequests, type DeviceKind } from "./people";
import { parseRelayStatus } from "./relay";
import {
  ENGINE_UNREACHABLE,
  parseServerStatus,
  readFamilyAnswer,
  type FamilyPurpose,
  type FamilyResult,
  type ServerFamilyStatus,
} from "./family";

export const FAMILY_API_PATH = "/api/skycot/family";

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
    typeof window !== "undefined" && new URL(url).origin === window.location.origin;
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (!sameOrigin || window.desktopBridge !== undefined) {
    const token = await readDesktopPrimaryBearerToken();
    if (token) headers["authorization"] = `Bearer ${token}`;
  }
  // The engine's own origin only (resolved above): never a relay or third-party address.
  const proof = readUnlockProof();
  if (proof !== null) headers["x-skycot-family-unlock"] = proof;
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
    const response = await callEngine(method, fullPath, body, query);
    const parsed: unknown = await response.json().catch(() => null);
    return readFamilyAnswer(response.status, parsed, decode);
  } catch {
    return { ok: false, reason: "unreachable", message: ENGINE_UNREACHABLE };
  }
}

export interface UnlockToken {
  readonly token: string;
  readonly sessionToken?: string;
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
        ...(typeof record["sessionToken"] === "string"
          ? { sessionToken: record["sessionToken"] }
          : {}),
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
  readonly askEachStep?: boolean;
  readonly readingLevel?: ReadingLevel;
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
  isSkycotCreatedFolder: (path: string) =>
    request(
      "GET",
      "/created-folder",
      undefined,
      (body) => {
        const created = (body as { createdBySkycot?: unknown } | null)?.createdBySkycot;
        return typeof created === "boolean" ? created : null;
      },
      { path },
    ),
  familyNotes: () =>
    request("GET", "/approver/notes", undefined, (body) => {
      const notes = (body as { notes?: unknown } | null)?.notes;
      return Array.isArray(notes) ? notes : null;
    }),
  answerFamilyNote: (input: {
    readonly id: string;
    readonly minutes: 0 | 15 | 30;
    readonly proof?: { readonly type: "code"; readonly code: string };
  }) =>
    request(
      "POST",
      "/approver/notes/answer",
      input,
      (body) => body !== null && typeof body === "object",
    ),
  seenFamilyNote: (id: string) =>
    request(
      "POST",
      "/approver/notes/seen",
      { id },
      (body) => body !== null && typeof body === "object",
    ),
  createNote: (input: {
    readonly kind: "shown" | "more-time";
    readonly threadId?: string;
    readonly title?: string;
  }) =>
    request("POST", "/notes/child", input, (body) => {
      const note = (body as { note?: unknown } | null)?.note;
      return typeof note === "object" && note !== null ? note : null;
    }),
  childNotes: () =>
    request("GET", "/notes/child", undefined, (body) => {
      const notes = (body as { notes?: unknown } | null)?.notes;
      return Array.isArray(notes) ? notes : null;
    }),
  status: () => request("GET", "", undefined, parseServerStatus),
  enable: (input: {
    readonly code: string;
    readonly childName: string | null;
    /** The first child's reading level and other settings, saved in the same write as the profile. */
    readonly child?: ChildPatch;
  }) => request("POST", "/enable", { ...input, timeZone: browserZone() }, parseServerStatus),
  addChild: (child: ChildPatch) =>
    request("POST", "/children/add", { child, timeZone: browserZone() }, parseAdded),
  updateChild: (input: { readonly childId: string; readonly patch: ChildPatch }) =>
    request("POST", "/children/update", { ...input, timeZone: browserZone() }, parseServerStatus),
  removeChild: (input: { readonly childId: string }) =>
    request("POST", "/children/remove", input, parseServerStatus),
  welcome: (input: { readonly state: "done" | "skipped" }) =>
    request("POST", "/welcome", input, parseServerStatus),
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
    readonly scope?: "once" | "project";
  }) => request("POST", "/verify", input, parseUnlock),
  renew: () => request("POST", "/renew", {}, parseUnlock),
  approveSession: (requestId: string, scope: "once" | "project" = "once") =>
    request("POST", "/approve-session", { requestId, scope }, (body) => body !== null),
  prepareUpdate: () => request("POST", "/prepare-update", {}, parseUnlock),
  disable: (input: { readonly code: string }) =>
    request("POST", "/disable", input, parseServerStatus),
  changeCode: (input: { readonly oldCode: string; readonly newCode: string }) =>
    request("POST", "/change-code", input, parseServerStatus),
  rename: (input: { readonly childName: string | null }) =>
    request("POST", "/rename", input, parseServerStatus),
  lock: () => request("POST", "/lock", {}, parseServerStatus),
  /** The code goes with the one request; the engine counts the try like any other. */
  allowAssistant: (input: { readonly driver: string; readonly code: string }) =>
    request("POST", "/assistants/allow", input, parseServerStatus),
  /** "Let this page use the internet": the code goes with the one request, counted as a try. */
  allowPageInternet: (input: {
    readonly page: string;
    readonly sites: ReadonlyArray<string>;
    readonly code: string;
    readonly threadId?: string;
    readonly scope?: "once" | "project";
  }) => request("POST", "/page-internet/allow", input, parseServerStatus),
  askPageInternet: (input: {
    readonly threadId: string;
    readonly page: string;
    readonly sites: ReadonlyArray<string>;
  }) =>
    request("POST", "/page-internet/ask", input, (body) => {
      const ask = (body as { ask?: { id?: unknown; expiresAt?: unknown } } | null)?.ask;
      return typeof ask?.id === "string" && typeof ask.expiresAt === "number"
        ? { id: ask.id, expiresAt: ask.expiresAt }
        : null;
    }),
  /** No code: taking a page's internet back only makes the profile stricter. */
  stopPageInternet: (input: { readonly page: string }) =>
    request("POST", "/page-internet/stop", input, parseServerStatus),
  stopProjectApproval: (id: string) =>
    request("POST", "/project-approvals/stop", { id }, parseServerStatus),
  /** A child's own project, or any project with a grown-up's yes: hidden from the children. */
  putAwayProject: (projectId: string) =>
    request("POST", "/projects/put-away", { projectId }, parseServerStatus),
  /** The child's Undo (inside the engine's short window), or a grown-up's yes. */
  bringBackProject: (projectId: string) =>
    request("POST", "/projects/bring-back", { projectId }, parseServerStatus),
  /** "For the kids": a grown-up shows (or hides again) a code project in the children's lists. */
  setProjectForKids: (input: { readonly projectId: string; readonly visible: boolean }) =>
    request("POST", "/projects/kids-visible", input, parseServerStatus),
  stopRememberedStart: (id: string) =>
    request("POST", "/remembered-starts/stop", { id }, () => true),
  /** "Trusted add-ons download by themselves": the code goes with the one request, either way. */
  setTrustedAddOns: (input: { readonly on: boolean; readonly code: string }) =>
    request("POST", "/trusted-add-ons", input, parseServerStatus),
  /** No code: taking an allowance back only makes the profile stricter. */
  stopAllowingAssistant: (input: { readonly driver: string }) =>
    request("POST", "/assistants/stop", input, parseServerStatus),
  // Who is who: people and devices (the family's Mac, with the Family settings' yes).
  devices: () => request("GET", "/devices", undefined, parseDeviceRows),
  linkAddresses: () =>
    request("GET", "/devices/link-addresses", undefined, (body) => {
      const addresses = (body as { addresses?: unknown } | null)?.addresses;
      if (!Array.isArray(addresses)) return null;
      return addresses.flatMap((entry: unknown) => {
        if (typeof entry !== "object" || entry === null) return [];
        const input = entry as Record<string, unknown>;
        return typeof input.label === "string" && typeof input.reachable === "boolean"
          ? [{ label: input.label, reachable: input.reachable }]
          : [];
      });
    }),
  linkDevice: (input: {
    readonly kind: DeviceKind;
    readonly personId: string;
    readonly name: string | null;
  }) => request("POST", "/devices/link", input, parseDeviceLink),
  removeDevice: (input: { readonly deviceId: string }) =>
    request("POST", "/devices/remove", input, parseDeviceRows),
  // SKYCOT Relay: reach this Mac from anywhere (the Mac only; the code to change it).
  relay: () => request("GET", "/relay", undefined, parseRelayStatus),
  setRelay: (input: { readonly enabled: boolean }) =>
    request("POST", "/relay", input, parseRelayStatus),
  addGrownUp: (person: { readonly name: string | null; readonly avatar?: ChildAvatar }) =>
    request("POST", "/people/add", { person }, parseServerStatus),
  updateGrownUp: (input: {
    readonly personId: string;
    readonly patch: { readonly name?: string | null; readonly avatar?: ChildAvatar };
  }) => request("POST", "/people/update", input, parseServerStatus),
  removeGrownUp: (input: { readonly personId: string }) =>
    request("POST", "/people/remove", input, parseServerStatus),
  // A grown-up's own device.
  pendingRequests: () => request("GET", "/approver/requests", undefined, parsePendingRequests),
  answerRequest: (input: {
    readonly threadId: string;
    readonly requestId: string;
    readonly decision: "accept" | "decline";
    readonly fingerprint: string;
    readonly proof: ApproverProof | null;
    readonly scope?: "once" | "project";
  }) => request("POST", "/approver/answer", input, okOnly),
  answerBatch: (input: {
    readonly batchId: string;
    readonly fingerprint: string;
    readonly decision: "accept" | "decline";
    readonly proof: ApproverProof | null;
    readonly via?: "watch";
  }) => request("POST", "/approver/answer-batch", input, okOnly),
  approverChallenge: (input: Record<string, string>) =>
    request("POST", "/approver/challenge", input, anyObject),
  approverMoreTime: (input: {
    readonly childId: string;
    readonly kind: "extra15" | "extra30" | "endBedtime";
    readonly proof: ApproverProof | null;
  }) => request("POST", "/approver/more-time", input, okOnly),
  lockEverything: () => request("POST", "/approver/lock-all", {}, okOnly),
  passkeyOptions: (input: { readonly code: string }) =>
    request("POST", "/devices/passkey/options", input, anyObject),
  passkeyRegister: (input: { readonly challenge: string; readonly response: unknown }) =>
    request("POST", "/devices/passkey/register", input, okOnly),
  passkeyForget: () => request("POST", "/devices/passkey/forget", {}, okOnly),
  unlinkSelf: () => request("POST", "/devices/unlink-self", {}, okOnly),
} satisfies Record<string, (...args: never[]) => Promise<FamilyResult<unknown>>>;

/** How a grown-up's device proves it is the grown-up for a yes: Face ID (a passkey) or the code. */
export type ApproverProof =
  | { readonly type: "code"; readonly code: string }
  | {
      readonly type: "passkey";
      readonly credentialId: string;
      readonly challenge: string;
      readonly response: unknown;
    };

function okOnly(body: unknown): true | null {
  return typeof body === "object" &&
    body !== null &&
    (body as Record<string, unknown>)["ok"] === true
    ? true
    : null;
}

function anyObject(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
}

export type { FamilyResult, ServerFamilyStatus, SessionLimits };
