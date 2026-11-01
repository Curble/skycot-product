import { describe, expect, it } from "vite-plus/test";

import {
  beginSend,
  buildItHeldBackNote,
  buildItHold,
  sendInFlight,
  whileSending,
} from "./sendsInFlight";

describe("sends in flight", () => {
  it("is on from the start of a send until it finishes, per conversation", () => {
    expect(sendInFlight("t1")).toBe(false);
    const end = beginSend("t1");
    expect(sendInFlight("t1")).toBe(true);
    expect(sendInFlight("t2")).toBe(false);
    end();
    expect(sendInFlight("t1")).toBe(false);
  });

  it("stays on until every send has finished, and ending twice counts once", () => {
    const first = beginSend("t1");
    const second = beginSend("t1");
    first();
    first();
    expect(sendInFlight("t1")).toBe(true);
    second();
    expect(sendInFlight("t1")).toBe(false);
  });
});

describe("Build it hold-back", () => {
  it("sees a send that started in the same tick, before its words are checked", async () => {
    let release: () => void = () => {};
    const checking = new Promise<void>((resolve) => (release = resolve));
    // Send starts, and Build it is pressed in the very same instant (no await between).
    const sending = whileSending("t9", () => checking);
    expect(buildItHold("t9", false)).toBe("other-message");
    release();
    await sending;
    expect(buildItHold("t9", false)).toBeNull();
  });

  it("clears the mark when the send fails", async () => {
    await expect(whileSending("t9", () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(sendInFlight("t9")).toBe(false);
  });

  it("says Sam is still finishing when no other message of the person's is going", () => {
    expect(buildItHold("t8", true)).toBe("assistant-busy");
    const note = buildItHeldBackNote("assistant-busy", "Sam");
    expect(note).toContain("Sam is still finishing");
    expect(note).not.toContain("other message");
    expect(buildItHeldBackNote("other-message", "Sam")).toContain(
      "Your other message is still going",
    );
  });

  it("prefers the other-message note when both are true", () => {
    const end = beginSend("t7");
    expect(buildItHold("t7", true)).toBe("other-message");
    end();
  });
});
