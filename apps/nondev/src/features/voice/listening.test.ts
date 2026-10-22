import { describe, expect, it } from "vite-plus/test";

import {
  LISTENING_LIMIT_MS,
  VoiceTyping,
  composeTranscript,
  problemFor,
  type RecognitionLike,
  type RecognitionResultsLike,
} from "./listening";

function results(...parts: ReadonlyArray<[string, boolean]>): RecognitionResultsLike {
  return Object.assign(
    parts.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })),
    { length: parts.length },
  );
}

class FakeRecognition implements RecognitionLike {
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: ((event: { readonly results: RecognitionResultsLike }) => void) | null = null;
  onerror: ((event: { readonly error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  stopped = 0;
  aborted = 0;
  throwOnStart = false;
  start() {
    if (this.throwOnStart) throw new Error("InvalidStateError");
    this.started += 1;
  }
  stop() {
    this.stopped += 1;
  }
  abort() {
    this.aborted += 1;
  }
}

function setup(options: { readonly unavailable?: boolean } = {}) {
  const recognitions: Array<FakeRecognition> = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const written: Array<string> = [];
  const machine = new VoiceTyping({
    createRecognition: () => {
      if (options.unavailable) return null;
      const recognition = new FakeRecognition();
      recognitions.push(recognition);
      return recognition;
    },
    lang: "en-AU",
    setTimer: (callback) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimer: (handle) => timers.delete(handle as number),
  });
  const phases: Array<string> = [];
  machine.subscribe(() => phases.push(machine.getState().phase));
  return {
    machine,
    recognitions,
    timers,
    written,
    phases,
    write: (text: string) => written.push(text),
    fireTimers: () => {
      for (const [id, callback] of Array.from(timers)) {
        timers.delete(id);
        callback();
      }
    },
  };
}

describe("composeTranscript", () => {
  it("capitalises the first word of an empty box", () => {
    expect(composeTranscript("", results(["make a game", false]))).toBe("Make a game");
  });

  it("adds the words after what was typed, with one space", () => {
    expect(composeTranscript("Please", results(["make a game", true]))).toBe("Please make a game");
    expect(composeTranscript("Please ", results(["make", true]))).toBe("Please make");
    expect(composeTranscript("Done.", results(["next one", true]))).toBe("Done. Next one");
  });

  it("joins final and still-changing results in order", () => {
    expect(composeTranscript("", results(["a birthday card", true], [" for my nan", false]))).toBe(
      "A birthday card for my nan",
    );
  });

  it("leaves the box alone when nothing was heard", () => {
    expect(composeTranscript("Hi", results(["  ", false]))).toBe("Hi");
  });
});

describe("problemFor", () => {
  it("sorts recogniser errors into what the person can do", () => {
    expect(problemFor("not-allowed")).toBe("denied");
    expect(problemFor("service-not-allowed")).toBe("unavailable");
    expect(problemFor("audio-capture")).toBe("no-microphone");
    expect(problemFor("no-speech")).toBe("no-speech");
    expect(problemFor("network")).toBe("network");
    expect(problemFor("aborted")).toBeNull();
  });
});

describe("VoiceTyping", () => {
  it("starts, writes live words into the box, and stops when asked", () => {
    const t = setup();
    expect(t.machine.start("", t.write)).toBe(true);
    const recognition = t.recognitions[0]!;
    expect(recognition).toMatchObject({ lang: "en-AU", continuous: true, interimResults: true });
    expect(t.machine.getState().phase).toBe("starting");
    recognition.onstart?.();
    expect(t.machine.getState().phase).toBe("listening");
    recognition.onresult?.({ results: results(["make a", false]) });
    recognition.onresult?.({ results: results(["make a game", true]) });
    expect(t.written).toEqual(["Make a", "Make a game"]);
    t.machine.stop();
    expect(recognition.stopped).toBe(1);
    expect(t.machine.getState().phase).toBe("stopping");
    recognition.onend?.();
    expect(t.machine.getState()).toEqual({ phase: "idle", problem: null });
    expect(t.timers.size).toBe(0);
  });

  it("keeps the words the recogniser finishes after Stop", () => {
    const t = setup();
    t.machine.start("Hi", t.write);
    const recognition = t.recognitions[0]!;
    recognition.onstart?.();
    t.machine.stop();
    recognition.onresult?.({ results: results(["there", true]) });
    recognition.onend?.();
    expect(t.written).toEqual(["Hi there"]);
  });

  it("explains a refused microphone and goes back to idle", () => {
    const t = setup();
    t.machine.start("", t.write);
    const recognition = t.recognitions[0]!;
    recognition.onerror?.({ error: "not-allowed" });
    recognition.onend?.();
    expect(t.machine.getState()).toEqual({ phase: "idle", problem: "denied" });
    t.machine.dismissProblem();
    expect(t.machine.getState().problem).toBeNull();
  });

  it("says when this browser cannot listen at all", () => {
    const t = setup({ unavailable: true });
    expect(t.machine.start("", t.write)).toBe(false);
    expect(t.machine.getState()).toEqual({ phase: "idle", problem: "unavailable" });
  });

  it("recovers when the recogniser refuses to start", () => {
    const refusing = new FakeRecognition();
    refusing.throwOnStart = true;
    const timers = new Set<number>();
    const machine = new VoiceTyping({
      createRecognition: () => refusing,
      lang: "en-AU",
      setTimer: () => {
        timers.add(1);
        return 1;
      },
      clearTimer: () => timers.delete(1),
    });
    expect(machine.start("", () => {})).toBe(false);
    expect(machine.getState()).toEqual({ phase: "idle", problem: "unavailable" });
    expect(timers.size).toBe(0);
  });

  it("stops by itself at the time limit and says why", () => {
    const t = setup();
    t.machine.start("", t.write);
    const recognition = t.recognitions[0]!;
    recognition.onstart?.();
    expect(LISTENING_LIMIT_MS).toBe(60_000);
    t.fireTimers();
    expect(recognition.stopped).toBe(1);
    recognition.onend?.();
    expect(t.machine.getState()).toEqual({ phase: "idle", problem: "time-limit" });
  });

  it("cancels at once (page hidden) and ignores anything the old recogniser says later", () => {
    const t = setup();
    t.machine.start("", t.write);
    const recognition = t.recognitions[0]!;
    recognition.onstart?.();
    const lateResult = recognition.onresult;
    t.machine.cancel();
    expect(recognition.aborted).toBe(1);
    expect(t.machine.getState().phase).toBe("idle");
    lateResult?.({ results: results(["too late", true]) });
    expect(t.written).toEqual([]);
    expect(t.timers.size).toBe(0);
  });

  it("uses a fresh recogniser for each session", () => {
    const t = setup();
    t.machine.start("", t.write);
    t.recognitions[0]!.onend?.();
    t.machine.start("", t.write);
    expect(t.recognitions).toHaveLength(2);
    expect(t.recognitions[1]!.started).toBe(1);
  });

  it("does nothing on a second start while already listening", () => {
    const t = setup();
    t.machine.start("", t.write);
    expect(t.machine.start("", t.write)).toBe(true);
    expect(t.recognitions).toHaveLength(1);
  });
});
