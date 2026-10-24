/**
 * The Family routes (`/api/skycot/family/*`), through a `MacTransport`.
 *
 * The same calls, answers and words as the plain client's `familyApi`
 * (apps/nondev/src/features/family/api.ts); only the way there differs (a bearer sign-in over
 * a transport instead of the browser's cookie). Parsing is the plain client's own code.
 */
import {
  readFamilyAnswer,
  parseServerStatus,
  ENGINE_UNREACHABLE,
  type FamilyResult,
  type ServerFamilyStatus,
} from "../../../nondev/src/features/family/family";
import {
  parsePendingRequests,
  type PendingRequest,
} from "../../../nondev/src/features/family/people";
import { parseFridge, type FridgeItem } from "../../../nondev/src/features/fridge/fridge";
import {
  parseLimitState,
  parseSessionLimits,
  type LimitState,
  type SessionLimits,
} from "../../../nondev/src/features/family-limits/limits";
import {
  parseRecap,
  type RecapRange,
  type RecapReport,
} from "../../../nondev/src/features/recap/recap";
import { parseBookView, type BookView } from "@t3tools/skycot-rules/badges";
import type { MacRequest, MacTransport } from "../transport/MacTransport";

export const FAMILY_API_PATH = "/api/skycot/family";

export type MoreTimeKind = "extra15" | "extra30" | "endBedtime";
export type ApproverProof =
  | { readonly type: "code"; readonly code: string }
  | {
      readonly type: "passkey";
      readonly credentialId: string;
      readonly challenge: string;
      readonly response: Readonly<Record<string, string>>;
    }
  | {
      /** The grown-up's Apple Watch, carried by this phone (Phase 4; see src/watch). */
      readonly type: "watch";
      readonly keyId: string;
      readonly challenge: string;
      readonly signature: string;
    }
  | {
      /** This phone's own Face ID key (Secure Enclave; see src/faceid). */
      readonly type: "device-key";
      readonly keyId: string;
      readonly challenge: string;
      readonly signature: string;
    };

/** A challenge the Mac gave for the Watch (or this phone's Face ID key) to sign. */
export interface WatchChallenge {
  readonly challenge: string;
  readonly action: string;
  readonly purpose: "register" | "approve";
  readonly keyId: string | null;
}

function parseWatchChallenge(body: unknown): WatchChallenge | null {
  const input = record(body);
  if (
    typeof input.challenge !== "string" ||
    typeof input.action !== "string" ||
    (input.purpose !== "register" && input.purpose !== "approve")
  ) {
    return null;
  }
  return {
    challenge: input.challenge,
    action: input.action,
    purpose: input.purpose,
    keyId: typeof input.keyId === "string" ? input.keyId : null,
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

async function call<A>(
  transport: MacTransport,
  input: MacRequest,
  decode: (body: unknown) => A | null,
): Promise<FamilyResult<A>> {
  try {
    const answer = await transport.request(input);
    return readFamilyAnswer(answer.status, answer.json, decode);
  } catch {
    return { ok: false, reason: "unreachable", message: ENGINE_UNREACHABLE };
  }
}

const ok = () => true as const;

export interface TodayEntry {
  readonly childId: string;
  readonly limits: LimitState | null;
  /**
   * Turns SKYCOT moved to another company today while the one in use was resting (driver ids).
   * Older engines leave it out.
   */
  readonly switches: ReadonlyArray<{
    readonly at: number;
    readonly from: string;
    readonly to: string;
  }>;
}

export interface Today {
  readonly children: ReadonlyArray<TodayEntry>;
  /** threadId → childId, for the conversations the engine knows the owner of. */
  readonly threads: Readonly<Record<string, string>>;
}

export type FamilyNote = {
  readonly id: string;
  readonly kind: "shown" | "more-time";
  readonly childId: string;
  readonly createdAt: string;
  readonly status: "open" | "done";
  readonly threadId?: string;
  readonly title?: string;
  readonly answer?: { readonly minutes: 0 | 15 | 30; readonly by: string; readonly at: string };
};

function parseFamilyNotes(body: unknown): ReadonlyArray<FamilyNote> | null {
  const notes = record(body).notes;
  if (!Array.isArray(notes)) return null;
  return notes.filter((value): value is FamilyNote => {
    const note = record(value);
    return (
      typeof note.id === "string" &&
      typeof note.childId === "string" &&
      typeof note.createdAt === "string" &&
      (note.kind === "shown" || note.kind === "more-time") &&
      (note.status === "open" || note.status === "done")
    );
  });
}

function parseToday(body: unknown): Today | null {
  const input = record(body);
  if (!Array.isArray(input.children)) return null;
  const children = input.children.flatMap((entry: unknown) => {
    const row = record(entry);
    const switches = (Array.isArray(row.switches) ? row.switches : []).flatMap((value: unknown) => {
      const entry = record(value);
      return typeof entry.at === "number" &&
        typeof entry.from === "string" &&
        typeof entry.to === "string"
        ? [{ at: entry.at, from: entry.from, to: entry.to }]
        : [];
    });
    return typeof row.childId === "string"
      ? [{ childId: row.childId, limits: parseLimitState(row.limits), switches }]
      : [];
  });
  const threads: Record<string, string> = {};
  for (const [threadId, childId] of Object.entries(record(input.threads))) {
    if (typeof childId === "string") threads[threadId] = childId;
  }
  return { children, threads };
}

export const familyApi = {
  status: (transport: MacTransport) =>
    call(transport, { method: "GET", path: FAMILY_API_PATH }, parseServerStatus),
  today: (transport: MacTransport) =>
    call(transport, { method: "GET", path: `${FAMILY_API_PATH}/today` }, parseToday),
  heartbeat: (transport: MacTransport, active: boolean) =>
    call(
      transport,
      { method: "POST", path: `${FAMILY_API_PATH}/heartbeat`, body: { active } },
      parseSessionLimits,
    ),
  /** A parent's yes for one thing on this device, as the Ask a grown-up card asks for it. */
  verify: (
    transport: MacTransport,
    input: { readonly code: string; readonly purpose: string; readonly requestId?: string },
  ) => call(transport, { method: "POST", path: `${FAMILY_API_PATH}/verify`, body: input }, ok),
  moreTime: (
    transport: MacTransport,
    input: { readonly childId: string; readonly kind: MoreTimeKind; readonly code: string },
  ) =>
    call(
      transport,
      { method: "POST", path: `${FAMILY_API_PATH}/more-time`, body: input },
      parseSessionLimits,
    ),
  fridge: (transport: MacTransport) =>
    call(transport, { method: "GET", path: `${FAMILY_API_PATH}/fridge` }, parseFridge),
  pin: (transport: MacTransport, threadId: string, pinned: boolean) =>
    call(
      transport,
      { method: "POST", path: `${FAMILY_API_PATH}/fridge/pin`, body: { threadId, pinned } },
      parseFridge,
    ),
  fridgePage: (transport: MacTransport, threadId: string, page: string) =>
    call(
      transport,
      { method: "GET", path: `${FAMILY_API_PATH}/fridge/page`, query: { threadId, page } },
      (body) => (typeof record(body).html === "string" ? (record(body).html as string) : null),
    ),
  recap: (transport: MacTransport, childId: string, range: RecapRange) =>
    call(
      transport,
      { method: "GET", path: `${FAMILY_API_PATH}/recap`, query: { childId, range } },
      parseRecap,
    ),
  /** The sticker book: `{ book }`, null while there's no child on this device. */
  stickers: (transport: MacTransport) =>
    call(transport, { method: "GET", path: "/api/skycot/badges" }, (body) => {
      const book = record(body).book;
      if (book === null) return { book: null };
      const parsed = parseBookView(book);
      return parsed === null ? null : { book: parsed };
    }),

  // A grown-up's phone: the approver routes (grown-up devices only; the engine checks).
  pendingRequests: (transport: MacTransport) =>
    call(
      transport,
      { method: "GET", path: `${FAMILY_API_PATH}/approver/requests` },
      parsePendingRequests,
    ),
  familyNotes: (transport: MacTransport) =>
    call(transport, { method: "GET", path: `${FAMILY_API_PATH}/approver/notes` }, parseFamilyNotes),
  answerFamilyNote: (
    transport: MacTransport,
    input: { readonly id: string; readonly minutes: 0 | 15 | 30; readonly proof?: ApproverProof },
  ) =>
    call(
      transport,
      { method: "POST", path: `${FAMILY_API_PATH}/approver/notes/answer`, body: input },
      ok,
    ),
  seenFamilyNote: (transport: MacTransport, id: string) =>
    call(
      transport,
      { method: "POST", path: `${FAMILY_API_PATH}/approver/notes/seen`, body: { id } },
      ok,
    ),
  answerRequest: (
    transport: MacTransport,
    input: {
      readonly threadId: string;
      readonly requestId: string;
      readonly decision: "accept" | "decline";
      readonly fingerprint: string;
      readonly proof: ApproverProof | null;
      /** A no said on the Watch (a yes from the Watch is known by its proof). */
      readonly via?: "watch";
    },
  ) =>
    call(
      transport,
      { method: "POST", path: `${FAMILY_API_PATH}/approver/answer`, body: input },
      ok,
    ),
  /** "Say yes from my Apple Watch": the parent code once; the Watch signs what comes back. */
  watchOptions: (transport: MacTransport, code: string) =>
    call(
      transport,
      { method: "POST", path: `${FAMILY_API_PATH}/approver/watch/options`, body: { code } },
      parseWatchChallenge,
    ),
  watchRegister: (
    transport: MacTransport,
    input: {
      readonly challenge: string;
      readonly publicKey: string;
      readonly signature: string;
      readonly name: string;
      readonly protection: "secure-enclave" | "keychain" | "simulator";
    },
  ) =>
    call(
      transport,
      { method: "POST", path: `${FAMILY_API_PATH}/approver/watch/register`, body: input },
      (body) => (typeof record(body).keyId === "string" ? (record(body).keyId as string) : null),
    ),
  watchForget: (transport: MacTransport) =>
    call(
      transport,
      { method: "POST", path: `${FAMILY_API_PATH}/approver/watch/forget`, body: {} },
      ok,
    ),
  watchChallenge: (
    transport: MacTransport,
    input: { readonly threadId: string; readonly requestId: string; readonly fingerprint: string },
  ) =>
    call(
      transport,
      { method: "POST", path: `${FAMILY_API_PATH}/approver/watch/challenge`, body: input },
      parseWatchChallenge,
    ),
  /** "Use Face ID to say yes": the parent code once; this phone's Face ID key signs what comes back. */
  deviceKeyOptions: (transport: MacTransport, code: string) =>
    call(
      transport,
      { method: "POST", path: `${FAMILY_API_PATH}/approver/device-key/options`, body: { code } },
      parseWatchChallenge,
    ),
  deviceKeyRegister: (
    transport: MacTransport,
    input: {
      readonly challenge: string;
      readonly publicKey: string;
      readonly signature: string;
      readonly biometry: "face-id" | "touch-id" | "optic-id";
    },
  ) =>
    call(
      transport,
      { method: "POST", path: `${FAMILY_API_PATH}/approver/device-key/register`, body: input },
      (body) => (typeof record(body).keyId === "string" ? (record(body).keyId as string) : null),
    ),
  deviceKeyForget: (transport: MacTransport) =>
    call(
      transport,
      { method: "POST", path: `${FAMILY_API_PATH}/approver/device-key/forget`, body: {} },
      ok,
    ),
  /** A one-use challenge for one yes with Face ID, for the card this phone shows. */
  deviceKeyChallenge: (
    transport: MacTransport,
    input: { readonly threadId: string; readonly requestId: string; readonly fingerprint: string },
  ) =>
    call(
      transport,
      { method: "POST", path: `${FAMILY_API_PATH}/approver/device-key/challenge`, body: input },
      parseWatchChallenge,
    ),
  approverMoreTime: (
    transport: MacTransport,
    input: { readonly childId: string; readonly kind: MoreTimeKind; readonly proof: ApproverProof },
  ) =>
    call(
      transport,
      { method: "POST", path: `${FAMILY_API_PATH}/approver/more-time`, body: input },
      ok,
    ),
  lockEverything: (transport: MacTransport) =>
    call(transport, { method: "POST", path: `${FAMILY_API_PATH}/approver/lock-all`, body: {} }, ok),
  unlinkSelf: (transport: MacTransport) =>
    call(
      transport,
      { method: "POST", path: `${FAMILY_API_PATH}/devices/unlink-self`, body: {} },
      ok,
    ),
} as const;

export type {
  BookView,
  FamilyResult,
  FridgeItem,
  LimitState,
  PendingRequest,
  RecapRange,
  RecapReport,
  ServerFamilyStatus,
  SessionLimits,
};
