// Every sentence voice typing and read-aloud say, in one place. Honest about where the sound
// goes: SKYCOT never records or keeps it, but the browser's recogniser may send it to the
// company that makes the browser, and the copy names that company.
import { MASCOT_NAME } from "../../brand";
import type { VoiceTypingProblem } from "./listening";
import type { SpeechService } from "./speech";

const PROVIDER: Record<Exclude<SpeechService, "none">, string> = {
  apple: "Apple",
  google: "Google",
  microsoft: "Microsoft",
  browser: "your browser's maker",
};

/** One line for Settings › Voice and the privacy pane: where the spoken words go. */
export function whereVoiceGoes(service: SpeechService): string {
  switch (service) {
    case "apple":
      return "Safari turns your voice into text with Apple's dictation. On newer Macs that can happen on the Mac itself; otherwise the sound goes to Apple to be turned into words, under Apple's privacy terms.";
    case "google":
      return "Chrome sends the sound of your voice to Google, which turns it into text under Google's privacy terms.";
    case "microsoft":
      return "Edge sends the sound of your voice to Microsoft, which turns it into text under Microsoft's privacy terms.";
    case "browser":
      return "This browser turns your voice into text with its own speech service, which may send the sound to its maker.";
    case "none":
      return "Voice typing isn't available here. It works when SKYCOT is open in Safari or Chrome on your Mac; the SKYCOT app window can't listen yet.";
  }
}

/** The short form beside the microphone. */
export function voiceProviderShort(service: SpeechService): string | null {
  return service === "none" ? null : `Words by ${PROVIDER[service]}`;
}

export const voiceCopy = {
  micLabel: `Talk to ${MASCOT_NAME}`,
  stopLabel: "Stop listening",
  starting: "Getting the microphone ready…",
  listening: "Listening… tap the microphone when you're done",
  stopping: "Finishing the last words…",
  never:
    "SKYCOT never records or keeps the sound. Your words appear in the box first, and nothing is sent until you press Send.",
  readLabel: "Read it to me",
  stopReading: "Stop reading",
  readAloudLocal:
    "Replies are read by a voice that lives on this Mac, so they don't go anywhere to be spoken. Code, links, file names and anything that looks like a password are skipped.",
  sample: `Hi! I'm ${MASCOT_NAME}. Tell me what you'd like to make, and I'll help you build it.`,
} as const;

export function problemSentence(problem: VoiceTypingProblem): string {
  switch (problem) {
    case "denied":
      return "The microphone isn't allowed. Allow it in the browser's address bar (or System Settings › Privacy & Security › Microphone), then try again.";
    case "unavailable":
      return "Voice typing is switched off on this Mac or in this browser. You can still type.";
    case "no-microphone":
      return "No microphone was found. Plug one in or check System Settings › Sound.";
    case "no-speech":
      return "I didn't hear anything. Tap the microphone and try again, a bit closer.";
    case "network":
      return "Voice typing needs the internet in this browser, and it couldn't connect. You can still type.";
    case "time-limit":
      return "I stopped listening after a minute. Tap the microphone to keep going.";
  }
}

/**
 * For the parent turning voice typing on for a child (Settings › Family): where this browser
 * sends the child's voice, in plain words, and which browser is the better choice for a child.
 */
export function whereChildVoiceGoes(
  service: SpeechService,
  childName: string | null,
): {
  readonly where: string;
  readonly advice: string | null;
} {
  const whose = childName ? `${childName}'s` : "the child's";
  const safari =
    "For children, Safari is the better choice: on recent Macs Apple's dictation can turn the voice into words on the Mac itself.";
  switch (service) {
    case "apple":
      return {
        where: `In Safari, Apple's dictation turns ${whose} voice into words. On recent Macs that can happen on the Mac itself; otherwise the sound goes to Apple, under Apple's privacy terms.`,
        advice: null,
      };
    case "google":
      return {
        where: `This browser is Chrome. It sends the sound of ${whose} voice to Google, which turns it into words under Google's privacy terms.`,
        advice: safari,
      };
    case "microsoft":
      return {
        where: `This browser is Edge. It sends the sound of ${whose} voice to Microsoft, which turns it into words under Microsoft's privacy terms.`,
        advice: safari,
      };
    case "browser":
      return {
        where: `This browser turns ${whose} voice into words with its own speech service, which may send the sound to its maker.`,
        advice: safari,
      };
    case "none":
      return {
        where:
          "This browser can't listen, so voice typing won't show here even when it's on. It works in Safari or Chrome on the Mac.",
        advice: null,
      };
  }
}
