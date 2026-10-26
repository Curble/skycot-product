/**
 * What SKYCOT on the iPhone and SKYCOT on a grown-up's Apple Watch say to each other, over
 * Apple's WatchConnectivity (Phase 4). The Watch has no link, sign-in or secret of its own for
 * the Mac: the phone is already Mum's linked grown-up device, so it reads the Mac and sends the
 * Watch only what the Watch shows (the snapshot below). The Watch sends back what Mum chose.
 *
 * Both sides speak JSON text, so the Swift side (apps/skycot-mobile/watch/SkycotWatch) decodes
 * exactly these shapes; `WATCH_PROTOCOL` changes when they do.
 */
export const WATCH_PROTOCOL = 1;

// nondev-seam: skycot-watch-project-approval-protocol
/** One "Ask a grown-up" waiting, as the Watch lists it. */
export interface WatchRequest {
  /** `<macId>:<requestId>`: unique across a family's Macs. */
  readonly id: string;
  readonly macId: string;
  readonly threadId: string;
  readonly requestId: string;
  /** The Mac's fingerprint of the card; the Watch checks it against `what` and `why`. */
  readonly fingerprint: string;
  readonly projectFingerprint?: string;
  readonly projectSentence?: string;
  readonly projectCovers?: ReadonlyArray<
    "webSearch" | "addOns" | "internetFetch" | "internetAssets"
  >;
  readonly projectTitle?: string;
  readonly goal?: string;
  readonly childName: string;
  readonly childInitial: string;
  readonly childColour: string;
  /** "Ava needs a grown-up". */
  readonly title: string;
  /** "Run a command", as the phone's card heading. */
  readonly heading: string;
  // nondev-seam: skycot-watch-request-sentence-protocol
  /** One plain sentence; the Watch does not show command details. */
  readonly sentence: string;
  /** The exact step (for example `npm install three`), as the phone shows it. */
  readonly what: string;
  readonly why: string | null;
  /** The Mac's name, when the family has more than one. */
  readonly macName: string | null;
  readonly createdAt: number;
  /** Older than 30 minutes: it waits on the Mac now. */
  readonly lapsed: boolean;
  /** This phone's Watch is set up to say yes on that Mac. */
  readonly watchCanSayYes: boolean;
  readonly batchId?: string;
  readonly batchFingerprint?: string;
  readonly batchCount?: number;
  readonly batchLead?: boolean;
}

/**
 * One family note the Watch lists ("Ava asked for more time", "Ava made something"). It never
 * carries what the child made or its title: a "shown" note says only that there is something to
 * see on the phone.
 */
export interface WatchNote {
  /** `<macId>:<noteId>`: unique across a family's Macs. */
  readonly id: string;
  readonly macId: string;
  readonly noteId: string;
  readonly kind: "more-time" | "shown";
  readonly childName: string;
  readonly childInitial: string;
  readonly childColour: string;
  /** "Ava asked for more time" or "Ava made something". */
  readonly title: string;
  /** One plain sentence under the title. */
  readonly sentence: string;
  /** The Mac's name, when the family has more than one. */
  readonly macName: string | null;
  readonly createdAt: number;
}

/** One child's day, in the words the phone's Children page uses. */
export interface WatchChild {
  readonly id: string;
  readonly macId: string;
  readonly name: string;
  readonly initial: string;
  readonly colour: string;
  /** "23 minutes of 1 hour". */
  readonly time: string;
  /** "7 of 30 messages". */
  readonly messages: string;
  /** "Bedtime 7:30 pm to 7 am", or null when there's no bedtime. */
  readonly bedtime: string | null;
  readonly asleep: boolean;
}

export type WatchSnapshotState =
  /** Linked as a grown-up's phone: the Watch can show everything. */
  | "ready"
  /** Not linked to a Mac yet. */
  | "not-linked"
  /** A child's device: the Watch app is for grown-ups only (v1). */
  | "child-device";

export interface WatchSnapshot {
  readonly protocol: typeof WATCH_PROTOCOL;
  readonly at: number;
  readonly state: WatchSnapshotState;
  readonly grownUpName: string;
  readonly requests: ReadonlyArray<WatchRequest>;
  /**
   * Open family notes. Added after protocol 1 shipped without changing it: a Watch that
   * doesn't know the field ignores it, and one that gets a snapshot without it shows none.
   */
  readonly notes: ReadonlyArray<WatchNote>;
  readonly children: ReadonlyArray<WatchChild>;
  /** Set up to say yes from this Watch on every linked Mac. */
  readonly watchSetUp: boolean;
  /** When "Lock SKYCOT now" last ran from this phone or its Watch. */
  readonly lockedAt: number | null;
  /** The phone can reach at least one of its Macs right now. */
  readonly reachable: boolean;
}

/** What the Watch may ask the phone to do. */
export type WatchMessage =
  | { readonly type: "hello" }
  | {
      readonly type: "challenge";
      readonly macId: string;
      readonly threadId?: string;
      readonly requestId?: string;
      readonly fingerprint: string;
      readonly batchId?: string;
      readonly scope?: "once" | "project";
    }
  | {
      readonly type: "answer";
      readonly macId: string;
      readonly threadId?: string;
      readonly requestId?: string;
      readonly fingerprint: string;
      readonly batchId?: string;
      readonly decision: "accept" | "decline";
      readonly scope?: "once" | "project";
      /** A yes only: the Watch's signature over the Mac's challenge. */
      readonly proof: {
        readonly keyId: string;
        readonly challenge: string;
        readonly signature: string;
      } | null;
    }
  | { readonly type: "lock" }
  /**
   * "Not tonight" on a note asking for more time. It needs no proof, as a no to a request needs
   * none. There is no 15 or 30 minutes here: more time stays with the parent code on the phone
   * (the Mac refuses a Watch's signature for it), so nothing in this message can give any.
   */
  | { readonly type: "noteNotTonight"; readonly macId: string; readonly noteId: string };

/** The phone's reply to any message. */
export type WatchReply =
  | { readonly ok: true; readonly snapshot?: WatchSnapshot; readonly sentence?: string }
  | {
      readonly ok: true;
      readonly challenge: string;
      readonly action: string;
      readonly keyId: string;
    }
  | { readonly ok: false; readonly sentence: string };

/** What the phone asks the Watch (setting up "Say yes from my Watch"). */
export interface WatchEnrolRequest {
  readonly type: "enrol";
  readonly challenge: string;
  readonly action: string;
}

export interface WatchEnrolReply {
  readonly publicKey: string;
  readonly signature: string;
  readonly protection: "secure-enclave" | "keychain" | "simulator";
  readonly name: string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

const text = (value: unknown, max = 512): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : null;

/** Reads a message from the Watch; anything else is null (and gets a plain refusal). */
export function parseWatchMessage(json: string): WatchMessage | null {
  let input: Record<string, unknown>;
  try {
    input = record(JSON.parse(json));
  } catch {
    return null;
  }
  switch (input.type) {
    case "hello":
      return { type: "hello" };
    case "lock":
      return { type: "lock" };
    case "noteNotTonight": {
      const macId = text(input.macId);
      const noteId = text(input.noteId);
      return macId === null || noteId === null ? null : { type: "noteNotTonight", macId, noteId };
    }
    case "challenge":
    case "answer": {
      const macId = text(input.macId);
      const batchId = text(input.batchId);
      const threadId = text(input.threadId);
      const requestId = text(input.requestId);
      const fingerprint = text(input.fingerprint, 128);
      if (
        macId === null ||
        fingerprint === null ||
        (batchId === null && (threadId === null || requestId === null))
      ) {
        return null;
      }
      if (input.type === "challenge") {
        return {
          type: "challenge",
          macId,
          ...(threadId === null || requestId === null ? {} : { threadId, requestId }),
          ...(batchId === null ? {} : { batchId }),
          fingerprint,
          ...(input.scope === "project" ? { scope: "project" as const } : {}),
        };
      }
      const decision = input.decision;
      if (decision !== "accept" && decision !== "decline") return null;
      const rawProof = record(input.proof);
      const keyId = text(rawProof.keyId, 128);
      const challenge = text(rawProof.challenge, 256);
      const signature = text(rawProof.signature, 256);
      const proof =
        keyId !== null && challenge !== null && signature !== null
          ? { keyId, challenge, signature }
          : null;
      // A yes always carries the Watch's signature; a no never needs one.
      if (decision === "accept" && proof === null) return null;
      return {
        type: "answer",
        macId,
        ...(threadId === null || requestId === null ? {} : { threadId, requestId }),
        ...(batchId === null ? {} : { batchId }),
        fingerprint,
        ...(input.scope === "project" ? { scope: "project" as const } : {}),
        decision,
        proof: decision === "accept" ? proof : null,
      };
    }
    default:
      return null;
  }
}

/** Reads the Watch's answer to "enrol"; null when it couldn't (or wouldn't) make a key. */
export function parseEnrolReply(json: string): WatchEnrolReply | null {
  let input: Record<string, unknown>;
  try {
    input = record(JSON.parse(json));
  } catch {
    return null;
  }
  const publicKey = text(input.publicKey);
  const signature = text(input.signature, 256);
  const protection = input.protection;
  if (
    publicKey === null ||
    signature === null ||
    (protection !== "secure-enclave" && protection !== "keychain" && protection !== "simulator")
  ) {
    return null;
  }
  return { publicKey, signature, protection, name: text(input.name, 80) ?? "Apple Watch" };
}
