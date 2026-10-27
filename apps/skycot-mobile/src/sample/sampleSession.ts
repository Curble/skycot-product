/**
 * What the sample family remembers while the sample is on, and nothing longer: which request was
 * answered, which notes were answered, what was pinned to or taken off the fridge, and the
 * messages typed in a sample conversation (each with Sam's one fixed reply). It lives only in
 * memory and is shared by the grown-up and Ava views, so switching view keeps it; leaving the
 * sample (or linking a real Mac) drops it. It is never saved and never sent anywhere.
 */

export const SAMPLE_SAM_REPLY =
  "In the sample, Sam just says hello — link your Mac to make things for real.";

export type SampleDecision = "accept" | "decline";

export interface SampleChatTurn {
  readonly id: string;
  readonly text: string;
  readonly reply: string;
  readonly at: number;
}

export interface SampleSession {
  /** requestId → what the grown-up decided. */
  readonly requests: Map<string, SampleDecision>;
  /** noteId → minutes given (0 is "not now"), and when. */
  readonly notes: Map<string, { readonly minutes: number; readonly at: number }>;
  /** threadId → pinned (true) or taken down (false); absent means "as recorded". */
  readonly pins: Map<string, boolean>;
  readonly chats: Map<string, Array<SampleChatTurn>>;
  /** When each pin was made, for the fridge's order. */
  readonly pinnedAt: Map<string, number>;
}

export const createSampleSession = (): SampleSession => ({
  requests: new Map(),
  notes: new Map(),
  pins: new Map(),
  chats: new Map(),
  pinnedAt: new Map(),
});

let active: SampleSession | null = null;

/** The session the screens share: made on first use, dropped by `endSampleSession`. */
export function activeSampleSession(): SampleSession {
  active ??= createSampleSession();
  return active;
}

export function endSampleSession(): void {
  active = null;
}
