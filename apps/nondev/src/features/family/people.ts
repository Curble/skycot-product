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
}

export function parsePendingRequests(body: unknown): ReadonlyArray<PendingRequest> | null {
  const requests = record(body)["requests"];
  if (!Array.isArray(requests)) return null;
  return requests.flatMap((entry: unknown) => {
    const input = record(entry);
    const threadId = text(input["threadId"]);
    const requestId = text(input["requestId"]);
    const fingerprint = text(input["fingerprint"]);
    if (threadId === null || requestId === null || fingerprint === null) return [];
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
      },
    ];
  });
}

/** The card's heading, in a child's terms: what the assistant wants to do. */
export function requestHeading(request: Pick<PendingRequest, "kind">): string {
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
