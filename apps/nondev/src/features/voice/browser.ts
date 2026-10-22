// The browser half of voice: finds SpeechRecognition / speechSynthesis, builds the one
// speaker for the page and a voice-typing machine per composer. Everything with a rule in it
// lives in the pure modules beside this one.
import { useSyncExternalStore } from "react";

import { isElectron } from "../../app/platform";
import { currentChild } from "../family/family";
import { useFamily } from "../family/FamilyProvider";
import {
  readAloudOn,
  useFamilyVoiceTypingOff,
  useReadAloudChoice,
  useVoiceTypingOff,
} from "../settings/localPrefs";
import { VoiceTyping, type RecognitionLike } from "./listening";
import { createSpeaker, type Speaker, type SynthesisLike, type UtteranceLike } from "./speaker";
import { preferredEnglish, speakingRate, speechServiceFor, type SpeechService } from "./speech";

type RecognitionConstructor = new () => RecognitionLike;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export const speechService: SpeechService =
  typeof navigator === "undefined"
    ? "none"
    : speechServiceFor({
        userAgent: navigator.userAgent,
        hasRecognition: recognitionConstructor() !== null,
        electron: isElectron,
      });

const accent =
  typeof navigator === "undefined"
    ? "en-AU"
    : preferredEnglish(navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");

export function createVoiceTyping(): VoiceTyping {
  return new VoiceTyping({
    createRecognition: () => {
      const Recognition = speechService === "none" ? null : recognitionConstructor();
      return Recognition === null ? null : new Recognition();
    },
    lang: accent,
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  });
}

let speakerInstance: Speaker | null = null;

/** The page's one speaker; created on first use so voices load after the first paint. */
export function speaker(): Speaker {
  if (speakerInstance !== null) return speakerInstance;
  const native =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window
      ? window.speechSynthesis
      : null;
  // Chrome fills the voice list asynchronously; asking once starts the load.
  native?.getVoices();
  // The speaker only ever hands back utterances it made with createUtterance below, so these
  // are real SpeechSynthesisUtterances; the narrow interfaces keep the speaker testable.
  const synthesis: SynthesisLike | null =
    native === null
      ? null
      : {
          speak: (utterance) => native.speak(utterance as unknown as SpeechSynthesisUtterance),
          cancel: () => native.cancel(),
          getVoices: () => native.getVoices(),
        };
  speakerInstance = createSpeaker({
    synthesis,
    createUtterance: (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
    preferredLang: accent,
  });
  return speakerInstance;
}

/** True while the reply with this id is being read. Re-renders only that reply's button. */
export function useIsSpeaking(id: string): boolean {
  const instance = speaker();
  return useSyncExternalStore(
    instance.subscribe,
    () => instance.getSpeakingId() === id,
    () => false,
  );
}

export interface VoiceSettings {
  /** The microphone button shows: the browser can listen and nobody switched it off. */
  readonly typing: boolean;
  /** Why it doesn't, for Settings. */
  readonly typingOffBecause: "browser" | "parent" | "choice" | null;
  readonly service: SpeechService;
  readonly readAloud: boolean;
  readonly canSpeak: boolean;
  readonly rate: number;
}

export function useVoiceSettings(): VoiceSettings {
  const family = useFamily();
  const choiceOff = useVoiceTypingOff();
  const parentOff = useFamilyVoiceTypingOff();
  const readAloudChoice = useReadAloudChoice();
  // In a Family profile the child's own settings (kept by the engine) decide: voice typing is
  // off until a parent turns it on for that child, and this device's switch can still keep it
  // off for everyone.
  const child = family.enabled ? currentChild(family.profile) : null;
  const childTyping = child?.voice.typing === true;
  const typingOffBecause =
    speechService === "none"
      ? "browser"
      : family.enabled && (parentOff || !childTyping)
        ? "parent"
        : choiceOff
          ? "choice"
          : null;
  const canSpeak = speaker().supported;
  return {
    typing: typingOffBecause === null,
    typingOffBecause,
    service: speechService,
    readAloud:
      canSpeak && readAloudOn(readAloudChoice, family.enabled && (child?.voice.readAloud ?? true)),
    canSpeak,
    rate: speakingRate(family.enabled),
  };
}
