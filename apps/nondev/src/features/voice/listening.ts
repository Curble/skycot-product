// Voice typing as a small state machine over the browser's SpeechRecognition. The recogniser,
// the timer and the text box are injected, so the whole lifecycle (start, live words, stop,
// errors, the time limit, leaving the page) runs in tests with fakes. Nothing is recorded or
// kept here: the recogniser hands back words and the words go into the message box, where
// the person can read and change them before pressing Send.

/** Listening stops on its own after this, so a forgotten tap never leaves the mic open. */
export const LISTENING_LIMIT_MS = 60_000;

export type VoiceTypingPhase = "idle" | "starting" | "listening" | "stopping";

/** Why the last attempt ended badly, in categories the copy can explain. */
export type VoiceTypingProblem =
  | "denied"
  | "unavailable"
  | "no-microphone"
  | "no-speech"
  | "network"
  | "time-limit";

export interface VoiceTypingState {
  readonly phase: VoiceTypingPhase;
  readonly problem: VoiceTypingProblem | null;
}

/** The parts of `SpeechRecognitionResultList` the machine reads. */
export interface RecognitionResultsLike {
  readonly length: number;
  readonly [index: number]: {
    readonly isFinal: boolean;
    readonly length: number;
    readonly [alternative: number]: { readonly transcript: string };
  };
}

/** The parts of `SpeechRecognition` the machine drives. */
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: { readonly results: RecognitionResultsLike }) => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface VoiceTypingDependencies {
  /** A fresh recogniser per session, or null when this browser has none. */
  readonly createRecognition: () => RecognitionLike | null;
  readonly lang: string;
  readonly setTimer: (callback: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  readonly limitMs?: number;
}

const IDLE: VoiceTypingState = { phase: "idle", problem: null };

/** The recogniser's error names, sorted into what the person can do about each. */
export function problemFor(error: string): VoiceTypingProblem | null {
  switch (error) {
    case "not-allowed":
      return "denied";
    case "service-not-allowed":
    case "language-not-supported":
    case "bad-grammar":
      return "unavailable";
    case "audio-capture":
      return "no-microphone";
    case "no-speech":
      return "no-speech";
    case "network":
      return "network";
    // "aborted" is our own cancel.
    default:
      return null;
  }
}

/**
 * The box's text with the spoken words after it. Words already in the box stay; a space
 * separates them; the first spoken word of an empty box gets a capital letter.
 */
export function composeTranscript(base: string, results: RecognitionResultsLike): string {
  const parts: Array<string> = [];
  for (let index = 0; index < results.length; index += 1) {
    const words = results[index]?.[0]?.transcript.trim() ?? "";
    if (words.length > 0) parts.push(words);
  }
  let spoken = parts.join(" ").replace(/\s+/g, " ");
  if (spoken.length === 0) return base;
  if (base.trim().length === 0 || /[.!?]\s*$/.test(base)) {
    spoken = spoken.charAt(0).toUpperCase() + spoken.slice(1);
  }
  if (base.length === 0) return spoken;
  return /\s$/.test(base) ? `${base}${spoken}` : `${base} ${spoken}`;
}

export class VoiceTyping {
  #state: VoiceTypingState = IDLE;
  readonly #listeners = new Set<() => void>();
  readonly #deps: VoiceTypingDependencies;
  #recognition: RecognitionLike | null = null;
  #timer: unknown = null;
  /** Bumped per session so a late event from an old recogniser changes nothing. */
  #session = 0;

  constructor(deps: VoiceTypingDependencies) {
    this.#deps = deps;
  }

  readonly getState = (): VoiceTypingState => this.#state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  get active(): boolean {
    return this.#state.phase !== "idle";
  }

  /**
   * Starts listening. `base` is the box's text now; `write` receives the box's new text on
   * every heard word. Returns false when this browser cannot listen.
   */
  start(base: string, write: (text: string) => void): boolean {
    if (this.active) return true;
    const recognition = this.#deps.createRecognition();
    if (recognition === null) {
      this.#set({ phase: "idle", problem: "unavailable" });
      return false;
    }
    const session = ++this.#session;
    const current = () => session === this.#session;
    recognition.lang = this.#deps.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      if (current() && this.#state.phase === "starting")
        this.#set({ phase: "listening", problem: null });
    };
    recognition.onresult = (event) => {
      if (!current()) return;
      if (this.#state.phase === "starting") this.#set({ phase: "listening", problem: null });
      write(composeTranscript(base, event.results));
    };
    recognition.onerror = (event) => {
      if (!current()) return;
      const problem = problemFor(event.error);
      if (problem !== null) this.#set({ phase: this.#state.phase, problem });
    };
    recognition.onend = () => {
      if (!current()) return;
      this.#finish(this.#state.problem);
    };
    this.#recognition = recognition;
    this.#set({ phase: "starting", problem: null });
    this.#timer = this.#deps.setTimer(() => {
      if (!current()) return;
      this.#set({ phase: this.#state.phase, problem: "time-limit" });
      this.stop();
    }, this.#deps.limitMs ?? LISTENING_LIMIT_MS);
    try {
      recognition.start();
    } catch {
      // Safari throws when a previous session has not fully released the microphone.
      this.#finish("unavailable");
      return false;
    }
    return true;
  }

  /** Stops listening and keeps the last words the recogniser is still finishing. */
  stop(): void {
    if (!this.active || this.#recognition === null) return;
    if (this.#state.phase !== "stopping")
      this.#set({ phase: "stopping", problem: this.#state.problem });
    try {
      this.#recognition.stop();
    } catch {
      this.#finish(this.#state.problem);
    }
  }

  /** Stops at once (page hidden, composer gone): words already in the box stay. */
  cancel(): void {
    if (!this.active) return;
    const recognition = this.#recognition;
    this.#finish(this.#state.problem);
    try {
      recognition?.abort();
    } catch {
      // Already gone.
    }
  }

  dismissProblem(): void {
    if (this.#state.problem !== null) this.#set({ phase: this.#state.phase, problem: null });
  }

  #finish(problem: VoiceTypingProblem | null): void {
    if (this.#timer !== null) {
      this.#deps.clearTimer(this.#timer);
      this.#timer = null;
    }
    const recognition = this.#recognition;
    if (recognition !== null) {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
    }
    this.#recognition = null;
    this.#session += 1;
    this.#set({ phase: "idle", problem });
  }

  #set(next: VoiceTypingState): void {
    if (next.phase === this.#state.phase && next.problem === this.#state.problem) return;
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }
}
