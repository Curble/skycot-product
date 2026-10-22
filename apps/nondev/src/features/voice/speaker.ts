// Read-aloud over the browser's speechSynthesis, which on a Mac uses the voices installed on
// the Mac itself: the reply is spoken locally and goes nowhere. One reply speaks at a time;
// the store says which, so its button can read "Stop". The browser objects are injected, so
// tests drive it with a fake synthesiser.
import { pickVoice, speechChunks, spokenText, type VoiceLike } from "./speech";

export interface UtteranceLike {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  voice: unknown;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export interface SynthesisLike {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  getVoices(): ReadonlyArray<VoiceLike>;
}

export interface SpeakerDependencies {
  readonly synthesis: SynthesisLike | null;
  readonly createUtterance: (text: string) => UtteranceLike;
  /** The person's language, e.g. navigator.language, for the accent choice. */
  readonly preferredLang?: string;
}

export interface SpeakOptions {
  readonly rate?: number;
}

export interface Speaker {
  readonly supported: boolean;
  /** Speaks a reply (Markdown) under `id`, stopping whatever was speaking. False if silent. */
  speak(id: string, markdown: string, options?: SpeakOptions): boolean;
  stop(): void;
  /** Ids already spoken by the automatic read-aloud, so a reply is read once. */
  markAutoRead(id: string): boolean;
  readonly getSpeakingId: () => string | null;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createSpeaker(deps: SpeakerDependencies): Speaker {
  let speakingId: string | null = null;
  let current: ReadonlyArray<UtteranceLike> = [];
  const autoRead = new Set<string>();
  const listeners = new Set<() => void>();
  const setSpeaking = (id: string | null) => {
    if (id === speakingId) return;
    speakingId = id;
    for (const listener of listeners) listener();
  };
  const synthesis = deps.synthesis;
  const detach = () => {
    for (const utterance of current) {
      utterance.onend = null;
      utterance.onerror = null;
    }
    current = [];
  };

  return {
    supported: synthesis !== null,
    speak(id, markdown, options = {}) {
      if (synthesis === null) return false;
      const text = spokenText(markdown);
      if (text.length === 0) return false;
      // cancel() fires the old utterances' onend in some browsers; detach them first.
      detach();
      synthesis.cancel();
      const voice = pickVoice(synthesis.getVoices(), deps.preferredLang);
      const utterances = speechChunks(text).map((chunk) => {
        const utterance = deps.createUtterance(chunk);
        if (voice !== null) {
          utterance.voice = voice;
          utterance.lang = voice.lang;
        }
        utterance.rate = options.rate ?? 1;
        utterance.pitch = 1;
        return utterance;
      });
      const last = utterances.at(-1)!;
      const done = () => {
        if (!current.includes(last)) return;
        detach();
        setSpeaking(null);
      };
      last.onend = done;
      // An error on any piece ends the whole reading: the rest would start mid-thought.
      for (const utterance of utterances)
        utterance.onerror = () => {
          if (!current.includes(utterance)) return;
          detach();
          synthesis.cancel();
          setSpeaking(null);
        };
      current = utterances;
      setSpeaking(id);
      for (const utterance of utterances) synthesis.speak(utterance);
      return true;
    },
    stop() {
      detach();
      synthesis?.cancel();
      setSpeaking(null);
    },
    markAutoRead(id) {
      if (autoRead.has(id)) return false;
      autoRead.add(id);
      return true;
    },
    getSpeakingId: () => speakingId,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
