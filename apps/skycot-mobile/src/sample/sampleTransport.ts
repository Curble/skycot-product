/**
 * The sample family's way "to the Mac": a `MacTransport` that answers from fixed data and
 * nothing else. It has no address, opens no socket and never calls `fetch`; every read is
 * answered from `sampleBank` plus what the sample session remembers (an answered request, a pin,
 * a message typed), and every write is a local acknowledgement that is only counted. The few
 * writes that matter to what the screens show (answering a request or a note, pinning, sending a
 * message) update the in-memory `SampleSession`; leaving the sample drops it.
 */
import type { MacRequest, MacResponse, MacTransport } from "../transport/MacTransport";
import type { ThreadProjection } from "../engine/types";
import { sampleBank, type SampleWho } from "./fixtures";
import {
  SAMPLE_SAM_REPLY,
  createSampleSession,
  type SampleChatTurn,
  type SampleDecision,
  type SampleSession,
} from "./sampleSession";

/** The engine's commands, in the sample, arrive here (there is no channel to send them down). */
export const SAMPLE_COMMAND_PATH = "/api/skycot/sample/command";

type Loose = Record<string, any>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const asRecord = (value: unknown): Loose =>
  typeof value === "object" && value !== null ? (value as Loose) : {};

const FAMILY = "/api/skycot/family";

export interface SampleTransport extends MacTransport {
  readonly kind: "sample";
  /** The writes that were acknowledged without doing anything (for tests and the review). */
  readonly acknowledged: () => ReadonlyArray<string>;
}

/** Thrown for the engine's command channel: the sample has none. */
export class SampleHasNoChannelError extends Error {
  override readonly name = "SampleHasNoChannelError";
}

const found = (json: unknown): MacResponse => ({ status: 200, json });
const notInSample = (): MacResponse => ({
  status: 403,
  json: { error: "not-allowed", message: "That isn't part of the sample family." },
});

export function createSampleTransport(
  who: SampleWho,
  clock: () => number = Date.now,
  session: SampleSession = createSampleSession(),
): SampleTransport {
  const bank = sampleBank(who, clock());
  const writes: Array<string> = [];

  const requestsNow = () => {
    const body = asRecord(bank.requests);
    return {
      ...body,
      requests: (body.requests as Array<Loose>).filter((r) => !session.requests.has(r.requestId)),
    };
  };
  const notesNow = () => ({
    notes: (asRecord(bank.notes).notes as Array<Loose>).map((note) => {
      const done = session.notes.get(note.id);
      return done === undefined
        ? note
        : {
            ...note,
            status: "done",
            answer: {
              minutes: done.minutes,
              by: asRecord(bank.status).grownUps?.[0]?.name ?? "A grown-up",
              at: new Date(done.at).toISOString(),
            },
          };
    }),
  });
  const fridgeNow = () => ({
    ...asRecord(bank.fridge),
    items: (asRecord(bank.fridge).items as Array<Loose>).map((item) => {
      const pinned = session.pins.get(item.threadId);
      if (pinned === undefined) return item;
      return {
        ...item,
        pinnedAt: pinned ? (session.pinnedAt.get(item.threadId) ?? clock()) : null,
      };
    }),
  });
  const answersNow = () => ({
    answers: [
      ...[...session.requests].map(([requestId, decision]) => ({
        requestId,
        decision,
        by: asRecord(bank.status).grownUps?.[0]?.name ?? "A grown-up",
        at: clock(),
      })),
      ...(asRecord(bank.answers).answers as Array<unknown>),
    ],
  });
  const threadNow = (id: string): ThreadProjection | undefined => {
    const base = bank.threads[id];
    if (base === undefined) return undefined;
    const projection = clone(base) as unknown as Loose;
    for (const request of projection.runtimeRequests as Array<Loose>) {
      const decision = session.requests.get(request.id);
      if (decision !== undefined && request.status === "pending") {
        request.status = "resolved";
        request.decision = decision;
        request.resolvedAt = new Date(clock()).toISOString();
      }
    }
    const turns = session.chats.get(id) ?? [];
    if (turns.length > 0) {
      const items = projection.visibleTurnItems as Array<{ position: number; item: Loose }>;
      // Any item of the thread can lend its bookkeeping fields (ids of the run, node and
      // provider turn), so a thread with no earlier assistant message (the plan-waiting one)
      // still gets a complete, finished message of the right shape.
      const find = (type: string) => items.find((entry) => entry.item.type === type)?.item;
      const lender = find("user_message") ?? find("assistant_message") ?? items[0]?.item ?? {};
      const messages = projection.messages as Array<Loose>;
      const messageLender = messages.find((m) => m.role === "user") ?? messages[0];
      let position = Math.max(0, ...items.map((entry) => entry.position));
      const add = (role: "user" | "assistant", turn: SampleChatTurn, text: string) => {
        const at = new Date(turn.at).toISOString();
        const messageId = `${turn.id}:${role}`;
        const own = find(role === "user" ? "user_message" : "assistant_message");
        const message = {
          createdBy: role === "user" ? "user" : "agent",
          creationSource: role === "user" ? "mobile" : "provider",
          ...(messageLender === undefined ? {} : clone(messageLender)),
          id: messageId,
          threadId: projection.thread.id,
          role,
          text,
          attachments: [],
          streaming: false,
          createdAt: at,
          updatedAt: at,
        };
        messages.push(message);
        const item = {
          ...clone(own ?? lender),
          id: `${turn.id}:${role}:item`,
          type: role === "user" ? "user_message" : "assistant_message",
          messageId,
          text,
          attachments: [],
          streaming: false,
          status: "completed",
          startedAt: at,
          completedAt: at,
          updatedAt: at,
        };
        if (role === "user") (item as Loose).inputIntent ??= "chat";
        position += 1;
        items.push({ position, item });
        projection.turnItems.push(item);
      };
      for (const turn of turns) {
        add("user", turn, turn.text);
        add("assistant", turn, turn.reply);
      }
      projection.thread.updatedAt = new Date(turns.at(-1)!.at).toISOString();
    }
    return projection as unknown as ThreadProjection;
  };
  const shellNow = () => {
    const shell = clone(bank.shell) as unknown as Loose;
    for (const thread of shell.threads as Array<Loose>) {
      const pending = thread.pendingRuntimeRequest as Loose | null;
      if (pending !== null && session.requests.has(pending.id)) {
        thread.pendingRuntimeRequest = null;
        if (thread.status === "waiting") thread.status = "completed";
      }
      const last = session.chats.get(thread.id)?.at(-1);
      if (last !== undefined) {
        const updatedAt = new Date(last.at).toISOString();
        thread.latestVisibleMessage = {
          id: `${last.id}:assistant`,
          role: "assistant",
          text: last.reply,
          updatedAt,
        };
        thread.latestUserMessageAt = updatedAt;
        thread.updatedAt = updatedAt;
      }
    }
    return shell;
  };

  const read = (input: MacRequest): MacResponse => {
    const query = input.query ?? {};
    switch (input.path) {
      case FAMILY:
        return found(bank.status);
      case `${FAMILY}/today`:
        return found(bank.today);
      case "/api/orchestration/shell":
        return found(shellNow());
      case `${FAMILY}/approver/requests`:
        return found(requestsNow());
      case `${FAMILY}/approver/notes`:
        return found(notesNow());
      case `${FAMILY}/fridge`:
        return found(fridgeNow());
      case `${FAMILY}/grown-up-answers`:
        return found(answersNow());
      case "/api/skycot/badges":
        return found(who === "child" ? bank.book : { book: null });
      case `${FAMILY}/recap`:
        return found(bank.recap(query.childId ?? "", query.range ?? "week"));
      case `${FAMILY}/fridge/page`: {
        const html = bank.pages[query.page ?? ""];
        return html === undefined
          ? { status: 404, json: { error: "gone", message: "That page isn't in the sample." } }
          : found({ html });
      }
      case `${FAMILY}/fridge/play`: {
        const html = bank.pages[query.page ?? ""];
        return html === undefined
          ? { status: 404, json: null }
          : found({
              html,
              reason: null,
              needs: { scripts: [], other: [] },
              diag: {
                packedBytes: html.length,
                embeddedFiles: 0,
                modulesBundled: false,
                missingFiles: [],
              },
              page: query.page ?? null,
            });
      }
      case `${FAMILY}/fridge/card`: {
        const svg = bank.cards[query.hash ?? ""];
        return svg === undefined
          ? { status: 404, json: null }
          : { status: 200, json: null, text: svg };
      }
      default: {
        const thread = /^\/api\/orchestration\/threads\/(.+)$/u.exec(input.path);
        const projection = thread === null ? undefined : threadNow(decodeURIComponent(thread[1]!));
        if (projection !== undefined) return found({ projection });
        return {
          status: 404,
          json: { error: "gone", message: "That isn't in the sample family." },
        };
      }
    }
  };

  const write = (input: MacRequest): MacResponse => {
    writes.push(input.path);
    switch (input.path) {
      case `${FAMILY}/heartbeat`:
      case `${FAMILY}/more-time`:
      case `${FAMILY}/approver/more-time`:
        return found((bank.status as { session: unknown }).session);
      case `${FAMILY}/fridge/pin`: {
        const body = asRecord(input.body);
        if (typeof body.threadId === "string" && typeof body.pinned === "boolean") {
          session.pins.set(body.threadId, body.pinned);
          if (body.pinned) session.pinnedAt.set(body.threadId, clock());
        }
        return found(fridgeNow());
      }
      case `${FAMILY}/approver/answer`: {
        const body = asRecord(input.body);
        if (typeof body.requestId === "string")
          session.requests.set(body.requestId, body.decision === "accept" ? "accept" : "decline");
        return found({ ok: true, sample: true });
      }
      case `${FAMILY}/approver/notes/answer`:
      case `${FAMILY}/approver/notes/seen`: {
        const body = asRecord(input.body);
        if (typeof body.id === "string")
          session.notes.set(body.id, {
            minutes: typeof body.minutes === "number" ? body.minutes : 0,
            at: clock(),
          });
        return found({ ok: true, sample: true });
      }
      case SAMPLE_COMMAND_PATH: {
        const body = asRecord(input.body);
        if (body.type === "respond" && typeof body.requestId === "string") {
          const decision: SampleDecision = body.decision === "accept" ? "accept" : "decline";
          session.requests.set(body.requestId, decision);
        }
        if (body.type === "message" && typeof body.threadId === "string") {
          const turns = session.chats.get(body.threadId) ?? [];
          turns.push({
            id: `sample-chat-${body.threadId}-${turns.length + 1}`,
            text: String(body.text ?? ""),
            reply: SAMPLE_SAM_REPLY,
            at: clock() + turns.length,
          });
          session.chats.set(body.threadId, turns);
        }
        return found({ ok: true, sample: true });
      }
      case `${FAMILY}/page-internet/ask`:
        return found({ ask: { id: "page-internet:sample", expiresAt: clock() + 5 * 60_000 } });
      // Face ID, the Watch and passkeys need the family's real Mac and this phone's own keys.
      case `${FAMILY}/approver/watch/options`:
      case `${FAMILY}/approver/watch/register`:
      case `${FAMILY}/approver/watch/challenge`:
      case `${FAMILY}/approver/device-key/options`:
      case `${FAMILY}/approver/device-key/register`:
      case `${FAMILY}/approver/device-key/challenge`:
        return notInSample();
      default:
        return found({ ok: true, sample: true });
    }
  };

  return {
    kind: "sample",
    routeLabel: "Sample family",
    acknowledged: () => [...writes],
    request: async (input) => (input.method === "GET" ? read(input) : write(input)),
    socket: async () => {
      throw new SampleHasNoChannelError("The sample family has no live connection.");
    },
  };
}

export const isSampleTransport = (transport: MacTransport): transport is SampleTransport =>
  transport.kind === "sample";
