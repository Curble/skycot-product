import { describe, expect, it } from "vite-plus/test";

import {
  pickVoice,
  preferredEnglish,
  speakingRate,
  speechChunks,
  speechServiceFor,
  spokenText,
  type VoiceLike,
} from "./speech";

describe("spoken text", () => {
  it("drops Markdown marks and reads lists and headings as sentences", () => {
    expect(spokenText("## Done!\n\nI made **three** things:\n- a cake\n- some *balloons*")).toBe(
      "Done! I made three things: a cake. some balloons.",
    );
  });

  it("never reads code out, and says once that there is some", () => {
    const text = 'Here it is:\n```html\n<div class="cake">🎂</div>\n```\nPress the button.';
    expect(spokenText(text)).toBe("Here it is: Press the button. There's some code on screen too.");
  });

  it("says “a file” instead of a path or a file name", () => {
    expect(spokenText("I saved it as `birthday-card.html` in /Users/sam/Projects/cards.")).toBe(
      "I saved it as a file in a file.",
    );
    expect(spokenText("Open src/pages/index.html to see it")).toBe("Open a file to see it.");
    expect(spokenText("I changed index.html, styles.css and app.js")).toBe("I changed some files.");
  });

  it("does not mistake ordinary slashes for paths", () => {
    expect(spokenText("Open 24/7 and/or on weekends.")).toBe("Open 24/7 and/or on weekends.");
  });

  it("never reads a secret, key or token verbatim", () => {
    const out = spokenText(
      "Your key is sk-proj-abcdefghijklmnop1234 and password: hunter2 and ghp_abcdefghijklmnopqrstuv12",
    );
    expect(out).not.toMatch(/abcdefghijklmnop|hunter2|ghp_/);
    expect(out).toContain("password (a secret)");
    expect(out).toContain("a secret");
  });

  it("keeps a link's words and drops its address", () => {
    expect(spokenText("See [the guide](https://example.com/guide?x=1) or https://t3.codes")).toBe(
      "See the guide or a link.",
    );
  });

  it("keeps short inline words and replaces longer code", () => {
    expect(spokenText("Press `Start` then run `document.querySelector('#x')`.")).toBe(
      "Press Start then run some code.",
    );
  });

  it("cuts a long reply at a sentence and says there is more", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const out = spokenText(long, 200);
    expect(out.length).toBeLessThan(240);
    expect(out.endsWith("There's more on screen.")).toBe(true);
    expect(out).toMatch(/is here\. There's more/);
  });

  it("returns nothing when nothing speakable is left", () => {
    expect(spokenText("   \n\n---\n")).toBe("");
  });
});

describe("speech chunks", () => {
  it("groups sentences into short pieces without splitting one", () => {
    const text = "One. Two is longer! Three? Four.";
    expect(speechChunks(text, 12)).toEqual(["One.", "Two is longer!", "Three? Four."]);
    expect(speechChunks(text, 200)).toEqual([text]);
    expect(speechChunks("No full stop")).toEqual(["No full stop"]);
  });
});

const voice = (name: string, lang: string, localService = true): VoiceLike => ({
  name,
  lang,
  localService,
  default: false,
});

describe("voice choice", () => {
  const voices = [
    voice("Zarvox", "en-US"),
    voice("Samantha", "en-US"),
    voice("Daniel", "en-GB"),
    voice("Karen", "en-AU"),
    voice("Google UK English Female", "en-GB", false),
    voice("Thomas", "fr-FR"),
  ];

  it("prefers an Australian, then British, then American voice on this Mac", () => {
    expect(pickVoice(voices)?.name).toBe("Karen");
    expect(pickVoice(voices.filter((v) => v.lang !== "en-AU"))?.name).toBe("Daniel");
    expect(pickVoice([voice("Samantha", "en-US"), voice("Zarvox", "en-US")])?.name).toBe(
      "Samantha",
    );
  });

  it("follows the person's own English accent first", () => {
    expect(pickVoice(voices, "en-US")?.name).toBe("Samantha");
  });

  it("prefers a voice on the Mac over a network one", () => {
    expect(
      pickVoice([voice("Google UK English Female", "en-GB", false), voice("Samantha", "en-US")])
        ?.name,
    ).toBe("Samantha");
  });

  it("never picks a novelty voice, and gives up without English", () => {
    expect(pickVoice([voice("Zarvox", "en-US"), voice("Bad News", "en-US")])).toBeNull();
    expect(pickVoice([voice("Thomas", "fr-FR")])).toBeNull();
  });

  it("reads a little slower for a Family profile", () => {
    expect(speakingRate(true)).toBeLessThan(speakingRate(false));
  });
});

describe("speech service", () => {
  const safari =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const chrome =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  const edge = `${chrome} Edg/140.0.0.0`;
  const electron =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) SKYCOT/0.1 Chrome/138.0 Electron/37.0 Safari/537.36";

  it("names who turns speech into text", () => {
    expect(speechServiceFor({ userAgent: safari, hasRecognition: true, electron: false })).toBe(
      "apple",
    );
    expect(speechServiceFor({ userAgent: chrome, hasRecognition: true, electron: false })).toBe(
      "google",
    );
    expect(speechServiceFor({ userAgent: edge, hasRecognition: true, electron: false })).toBe(
      "microsoft",
    );
  });

  it("offers no voice typing in the desktop window or without a recogniser", () => {
    expect(speechServiceFor({ userAgent: electron, hasRecognition: true, electron: false })).toBe(
      "none",
    );
    expect(speechServiceFor({ userAgent: chrome, hasRecognition: true, electron: true })).toBe(
      "none",
    );
    expect(speechServiceFor({ userAgent: chrome, hasRecognition: false, electron: false })).toBe(
      "none",
    );
  });
});

describe("preferred English", () => {
  it("speaks and listens Australian in an Australian time zone, whatever the browser says", () => {
    expect(preferredEnglish("en-GB", "Australia/Melbourne")).toBe("en-AU");
    expect(preferredEnglish("en-US", "Pacific/Auckland")).toBe("en-NZ");
    expect(preferredEnglish("en-US", "America/New_York")).toBe("en-US");
    expect(preferredEnglish("fr-FR", "Europe/Paris")).toBe("en-AU");
  });

  it("names Google for headless Chrome too", () => {
    expect(
      speechServiceFor({
        userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 HeadlessChrome/140.0 Safari/537.36",
        hasRecognition: true,
        electron: false,
      }),
    ).toBe("google");
  });
});
