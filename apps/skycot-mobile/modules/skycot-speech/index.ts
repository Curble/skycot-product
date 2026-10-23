/**
 * Voice typing, on this device only (modules/skycot-speech/ios/SkycotSpeechModule.swift).
 * Off for a child until a grown-up turns talking on in that child's settings on the Mac.
 */
import { requireOptionalNativeModule, type EventSubscription } from "expo";

interface SkycotSpeechNative {
  availability(locale?: string): Promise<"available" | "busy" | "not-on-device" | "unsupported">;
  requestPermissions(): Promise<boolean>;
  start(locale?: string): Promise<void>;
  stop(): Promise<void>;
  addListener(
    event: "onTranscript",
    listener: (event: { readonly text: string; readonly isFinal: boolean }) => void,
  ): EventSubscription;
  addListener(event: "onEnd", listener: () => void): EventSubscription;
}

export const SkycotSpeech = requireOptionalNativeModule<SkycotSpeechNative>("SkycotSpeech");
