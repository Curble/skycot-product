import { describe, expect, it } from "vite-plus/test";

import { createSpeaker, type SynthesisLike, type UtteranceLike } from "./speaker";
import type { VoiceLike } from "./speech";

function setup(voices: ReadonlyArray<VoiceLike> = []) {
  const spoken: Array<UtteranceLike> = [];
  let cancels = 0;
  const synthesis: SynthesisLike = {
    speak: (utterance) => spoken.push(utterance),
    cancel: () => {
      cancels += 1;
    },
    getVoices: () => voices,
  };
  const speaker = createSpeaker({
    synthesis,
    createUtterance: (text) => ({
      text,
      lang: "",
      rate: 1,
      pitch: 1,
      voice: null,
      onend: null,
      onerror: null,
    }),
    preferredLang: "en-AU",
  });
  const changes: Array<string | null> = [];
  speaker.subscribe(() => changes.push(speaker.getSpeakingId()));
  return { speaker, spoken, changes, cancels: () => cancels };
}

describe("speaker", () => {
  it("reads the plain words of a reply in a friendly local voice, at the asked rate", () => {
    const karen = { name: "Karen", lang: "en-AU", localService: true, default: false };
    const t = setup([{ name: "Zarvox", lang: "en-US", localService: true, default: true }, karen]);
    expect(t.speaker.speak("m1", "**Done!** I made `birthday-card.html`.", { rate: 0.9 })).toBe(
      true,
    );
    expect(t.spoken).toHaveLength(1);
    expect(t.spoken[0]).toMatchObject({ text: "Done! I made a file.", rate: 0.9, voice: karen });
    expect(t.speaker.getSpeakingId()).toBe("m1");
  });

  it("clears the speaking reply when the last piece ends", () => {
    const t = setup();
    const long = Array.from({ length: 12 }, (_, i) => `This is sentence ${i}.`).join(" ");
    t.speaker.speak("m1", long);
    expect(t.spoken.length).toBeGreaterThan(1);
    t.spoken[0]!.onend?.();
    expect(t.speaker.getSpeakingId()).toBe("m1");
    t.spoken.at(-1)!.onend?.();
    expect(t.speaker.getSpeakingId()).toBeNull();
    expect(t.changes).toEqual(["m1", null]);
  });

  it("speaks one reply at a time; a late end from the old one changes nothing", () => {
    const t = setup();
    t.speaker.speak("m1", "First.");
    const first = t.spoken[0]!;
    const firstEnd = first.onend;
    t.speaker.speak("m2", "Second.");
    expect(t.cancels()).toBe(2);
    expect(first.onend).toBeNull();
    firstEnd?.();
    expect(t.speaker.getSpeakingId()).toBe("m2");
  });

  it("stops on request", () => {
    const t = setup();
    t.speaker.speak("m1", "Hello there.");
    t.speaker.stop();
    expect(t.speaker.getSpeakingId()).toBeNull();
  });

  it("stays silent for a reply with nothing to say aloud", () => {
    const t = setup();
    expect(t.speaker.speak("m1", "```\ncode only\n```".replace("code only", ""))).toBe(true);
    expect(t.speaker.speak("m2", "   ")).toBe(false);
  });

  it("reads each reply automatically only once", () => {
    const t = setup();
    expect(t.speaker.markAutoRead("m1")).toBe(true);
    expect(t.speaker.markAutoRead("m1")).toBe(false);
  });

  it("reports no support without a synthesiser", () => {
    const speaker = createSpeaker({
      synthesis: null,
      createUtterance: () => {
        throw new Error("unused");
      },
    });
    expect(speaker.supported).toBe(false);
    expect(speaker.speak("m1", "Hello")).toBe(false);
  });
});
