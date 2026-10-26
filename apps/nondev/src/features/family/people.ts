// Who is who, as this client reads it: the grown-ups, the devices linked to a person, and who
// this device is (`me`). The engine decides all of it (apps/server/src/skycot/family-devices);
// the screens only show it. Pure: parsing and plain words.
import { parseAvatar, type ChildAvatar } from "./children";

export interface FamilyGrownUp {
  readonly id: string;
  readonly name: string | null;
  readonly avatar: ChildAvatar;
}

export type DeviceKind = "child" | "grown-up";

/** A linked device as the profile lists it. */
export interface FamilyDeviceSummary {
  readonly id: string;
  readonly kind: DeviceKind;
  readonly personId: string;
  readonly name: string;
  readonly passkeys: number;
  /** A grown-up's phone: its Apple Watch that may say yes through it, by name. */
  readonly watch: string | null;
  /** A grown-up's device that says yes with its own Face ID key. Older engines leave it out. */
  readonly faceId: boolean;
}

/** Who this device is, as the engine says. */
export type FamilyMe =
  | { readonly kind: "shared" }
  | {
      readonly kind: "child";
      readonly deviceId: string;
      readonly deviceName: string;
      readonly childId: string;
    }
  | {
      readonly kind: "grown-up";
      readonly deviceId: string;
      readonly deviceName: string;
      readonly personId: string;
    };

export const SHARED_ME: FamilyMe = { kind: "shared" };

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
const text = (value: unknown) => (typeof value === "string" ? value : null);

export function parseGrownUps(value: unknown): ReadonlyArray<FamilyGrownUp> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const input = record(entry);
    const id = text(input["id"]);
    if (id === null) return [];
    const name = text(input["name"]);
    return [{ id, name: name && name.trim() ? name : null, avatar: parseAvatar(input["avatar"]) }];
  });
}

export function parseDevices(value: unknown): ReadonlyArray<FamilyDeviceSummary> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const input = record(entry);
    const id = text(input["id"]);
    const personId = text(input["personId"]);
    const kind = input["kind"];
    if (id === null || personId === null || (kind !== "child" && kind !== "grown-up")) return [];
    return [
      {
        id,
        kind,
        personId,
        name: text(input["name"]) ?? "A device",
        passkeys: typeof input["passkeys"] === "number" ? input["passkeys"] : 0,
        watch: text(input["watch"]),
        faceId: input["faceId"] === true,
      },
    ];
  });
}

export function parseMe(value: unknown): FamilyMe {
  const input = record(value);
  const deviceId = text(input["deviceId"]);
  const deviceName = text(input["deviceName"]) ?? "This device";
  if (input["kind"] === "child" && deviceId !== null && text(input["childId"]) !== null) {
    return { kind: "child", deviceId, deviceName, childId: text(input["childId"])! };
  }
  if (input["kind"] === "grown-up" && deviceId !== null && text(input["personId"]) !== null) {
    return { kind: "grown-up", deviceId, deviceName, personId: text(input["personId"])! };
  }
  return SHARED_ME;
}

/** "Mum", or "Grown-up 2" for one without a name. */
export function grownUpLabel(person: Pick<FamilyGrownUp, "name">, index: number): string {
  return person.name ?? (index === 0 ? "Grown-up" : `Grown-up ${index + 1}`);
}

/** A device row in Settings › Family, from the engine's devices list. */
export interface DeviceRow {
  readonly id: string;
  readonly kind: DeviceKind;
  readonly personId: string;
  readonly name: string;
  readonly status: "waiting" | "linked";
  readonly linkExpiresAt: number | null;
  readonly lastSeenAt: string | null;
  readonly connected: boolean;
  readonly passkey: boolean;
  /** The Apple Watch that may say yes through this phone, by name. */
  readonly watch: string | null;
  /** Says yes with its own Face ID key. */
  readonly faceId: boolean;
}

export function parseDeviceRows(body: unknown): ReadonlyArray<DeviceRow> | null {
  const devices = record(body)["devices"];
  if (!Array.isArray(devices)) return null;
  return devices.flatMap((entry: unknown) => {
    const input = record(entry);
    const id = text(input["id"]);
    const personId = text(input["personId"]);
    const kind = input["kind"];
    if (id === null || personId === null || (kind !== "child" && kind !== "grown-up")) return [];
    return [
      {
        id,
        kind,
        personId,
        name: text(input["name"]) ?? "A device",
        status: input["status"] === "linked" ? "linked" : "waiting",
        linkExpiresAt: typeof input["linkExpiresAt"] === "number" ? input["linkExpiresAt"] : null,
        lastSeenAt: text(input["lastSeenAt"]),
        connected: input["connected"] === true,
        passkey: input["passkey"] === true,
        watch: text(input["watch"]),
        faceId: input["faceId"] === true,
      },
    ];
  });
}

/** "Here now", "Seen 5 minutes ago", "Seen yesterday", "Waiting to be linked". */
export function lastSeenPhrase(
  row: Pick<DeviceRow, "status" | "connected" | "lastSeenAt">,
  now: number,
): string {
  if (row.status === "waiting") return "Waiting for its link to be opened";
  if (row.connected) return "Using SKYCOT now";
  if (row.lastSeenAt === null) return "Linked";
  const at = Date.parse(row.lastSeenAt);
  if (Number.isNaN(at)) return "Linked";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "Seen just now";
  if (minutes < 60) return `Seen ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Seen ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Seen yesterday" : `Seen ${days} days ago`;
}

/** A one-time link the engine made: the code to type, and where another device can open it. */
export interface DeviceLink {
  readonly deviceId: string;
  readonly code: string;
  readonly expiresAt: number;
  readonly links: ReadonlyArray<{
    readonly label: string;
    readonly url: string;
    readonly reachable: boolean;
  }>;
}

export function parseDeviceLink(body: unknown): DeviceLink | null {
  const input = record(body);
  const deviceId = text(input["deviceId"]);
  const code = text(input["code"]);
  if (deviceId === null || code === null || typeof input["expiresAt"] !== "number") return null;
  const links = Array.isArray(input["links"])
    ? input["links"].flatMap((entry: unknown) => {
        const link = record(entry);
        const url = text(link["url"]);
        return url === null
          ? []
          : [{ label: text(link["label"]) ?? "Link", url, reachable: link["reachable"] === true }];
      })
    : [];
  return { deviceId, code, expiresAt: input["expiresAt"], links };
}

/** A request waiting for a grown-up, as a grown-up's phone shows it. */
export interface PendingRequest {
  /** Missing on older Mac responses and means the usual runtime request. */
  readonly target?: "runtime-request" | "page-internet";
  readonly threadId: string;
  readonly requestId: string;
  readonly childId: string | null;
  readonly threadTitle: string;
  readonly projectTitle: string | null;
  readonly createdAt: number;
  readonly lapsed: boolean;
  readonly needsGrownUp: boolean;
  readonly why: string | null;
  readonly what: string;
  readonly kind: string;
  readonly fingerprint: string;
  readonly projectFingerprint?: string;
  readonly projectCovers?: ReadonlyArray<
    "webSearch" | "addOns" | "internetFetch" | "internetAssets"
  >;
  readonly page?: string;
  readonly sites?: ReadonlyArray<string>;
  readonly batch?: ApprovalBatch;
}

export interface ApprovalBatch {
  readonly id: string;
  readonly childId: string;
  readonly project: string;
  readonly kind: "webSearch" | "addOns" | "internetFetch" | "internetAssets";
  readonly fingerprint: string;
  readonly items: ReadonlyArray<{
    readonly threadId: string;
    readonly requestId: string;
    readonly what: string;
    readonly fingerprint: string;
  }>;
}

export function approvalBatchSentence(
  batch: ApprovalBatch,
  childName: string,
  projectTitle: string | null,
): string {
  const request =
    batch.kind === "internetAssets"
      ? "pictures and files from the internet"
      : batch.kind === "internetFetch"
        ? "downloads from the internet"
        : batch.kind === "webSearch"
          ? "web searches"
          : "add-ons";
  return `${childName}'s ${projectTitle ?? "project"} wants ${batch.items.length} ${request}.`;
}

/**
 * The approver route's list, as a grown-up's device keeps it: only what needs a grown-up. The
 * Mac already leaves out a child's own "Ask me first" steps; an older Mac sent them marked
 * `needsGrownUp: false`, and they are dropped here too, so nothing a grown-up's device lists,
 * counts, mirrors or notifies about is the child's to answer at the Mac.
 */
export function parsePendingRequests(body: unknown): ReadonlyArray<PendingRequest> | null {
  const requests = record(body)["requests"];
  if (!Array.isArray(requests)) return null;
  const batches = Array.isArray(record(body)["batches"])
    ? (record(body)["batches"] as unknown[]).flatMap((entry): ApprovalBatch[] => {
        const input = record(entry);
        const items = Array.isArray(input["items"])
          ? input["items"].flatMap((row) => {
              const item = record(row);
              const threadId = text(item["threadId"]);
              const requestId = text(item["requestId"]);
              const fingerprint = text(item["fingerprint"]);
              return threadId && requestId && fingerprint
                ? [{ threadId, requestId, fingerprint, what: text(item["what"]) ?? "" }]
                : [];
            })
          : [];
        const kind = input["kind"];
        const id = text(input["id"]);
        const childId = text(input["childId"]);
        const project = text(input["project"]);
        const fingerprint = text(input["fingerprint"]);
        return id &&
          childId &&
          project &&
          fingerprint &&
          items.length > 1 &&
          (kind === "webSearch" ||
            kind === "addOns" ||
            kind === "internetFetch" ||
            kind === "internetAssets")
          ? [{ id, childId, project, kind, fingerprint, items }]
          : [];
      })
    : [];
  return requests.flatMap((entry: unknown) => {
    const input = record(entry);
    const threadId = text(input["threadId"]);
    const requestId = text(input["requestId"]);
    const fingerprint = text(input["fingerprint"]);
    if (threadId === null || requestId === null || fingerprint === null) return [];
    if (input["needsGrownUp"] === false) return [];
    const batch = batches.find((candidate) =>
      candidate.items.some((item) => item.threadId === threadId && item.requestId === requestId),
    );
    return [
      {
        threadId,
        requestId,
        childId: text(input["childId"]),
        threadTitle: text(input["threadTitle"]) ?? "A conversation",
        projectTitle: text(input["projectTitle"]),
        createdAt: typeof input["createdAt"] === "number" ? input["createdAt"] : 0,
        lapsed: input["lapsed"] === true,
        needsGrownUp: input["needsGrownUp"] !== false,
        why: text(input["why"]),
        what: text(input["what"]) ?? "",
        kind: text(input["kind"]) ?? "command",
        fingerprint,
        ...(text(input["projectFingerprint"]) === null
          ? {}
          : { projectFingerprint: text(input["projectFingerprint"])! }),
        ...(Array.isArray(input["projectCovers"])
          ? {
              projectCovers: input["projectCovers"].filter(
                (cover): cover is "webSearch" | "addOns" | "internetFetch" | "internetAssets" =>
                  cover === "webSearch" ||
                  cover === "addOns" ||
                  cover === "internetFetch" ||
                  cover === "internetAssets",
              ),
            }
          : {}),
        ...(input["target"] === "page-internet" ? { target: "page-internet" as const } : {}),
        ...(typeof input["page"] === "string" ? { page: input["page"] } : {}),
        ...(Array.isArray(input["sites"])
          ? { sites: input["sites"].filter((site): site is string => typeof site === "string") }
          : {}),
        ...(batch === undefined ? {} : { batch }),
      },
    ];
  });
}

/** The card's heading, in a child's terms: what the assistant wants to do. */
export function requestHeading(request: Pick<PendingRequest, "kind">): string {
  if (request.kind === "page-internet") return "This page wants the internet";
  switch (request.kind) {
    case "command":
      return "Run a command";
    case "file-change":
      return "Change some files";
    case "file-read":
      return "Read some files";
    default:
      return "Do something that needs a grown-up";
  }
}

/** A grown-up sees the plain reason first; the exact command stays available below it. */
export function grownUpRequestSentence(
  request: Pick<PendingRequest, "kind" | "what" | "page" | "sites">,
  childName: string,
): string {
  if (request.kind === "page-internet") {
    const page = request.page?.split("/").at(-1) ?? "page";
    const sites = request.sites?.join(", ") ?? "the listed internet sites";
    return `${childName}'s ${page} wants pictures and information from ${sites}.`;
  }
  const what = request.what.toLowerCase();
  if (request.kind === "command" && /three(?:\.js)?/.test(what)) {
    return `${childName}'s game wants to download a free 3D tool (three.js) from the internet.`;
  }
  if (request.kind === "command" && /\b(download|install)\b/.test(what)) {
    return `${childName}'s project wants to download a tool from the internet.`;
  }
  return `${childName} needs a grown-up's help with one step.`;
}
