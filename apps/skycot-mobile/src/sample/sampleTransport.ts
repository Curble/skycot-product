/**
 * The sample family's way "to the Mac": a `MacTransport` that answers from fixed data and
 * nothing else. It has no address, opens no socket and never calls `fetch`; every read is
 * answered from `sampleBank`, and every write is turned into a harmless local acknowledgement
 * that changes nothing and is only counted, so the screens can say what would have happened.
 * Dropping the transport (leaving the sample) drops everything it held.
 */
import type { MacRequest, MacResponse, MacTransport } from "../transport/MacTransport";
import { sampleBank, type SampleWho } from "./fixtures";

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
): SampleTransport {
  const bank = sampleBank(who, clock());
  const writes: Array<string> = [];

  const read = (input: MacRequest): MacResponse => {
    const query = input.query ?? {};
    switch (input.path) {
      case FAMILY:
        return found(bank.status);
      case `${FAMILY}/today`:
        return found(bank.today);
      case "/api/orchestration/shell":
        return found(bank.shell);
      case `${FAMILY}/approver/requests`:
        return found(bank.requests);
      case `${FAMILY}/approver/notes`:
        return found(bank.notes);
      case `${FAMILY}/fridge`:
        return found(bank.fridge);
      case `${FAMILY}/grown-up-answers`:
        return found(bank.answers);
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
        const projection =
          thread === null ? undefined : bank.threads[decodeURIComponent(thread[1]!)];
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
      case `${FAMILY}/fridge/pin`:
        return found(bank.fridge);
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
