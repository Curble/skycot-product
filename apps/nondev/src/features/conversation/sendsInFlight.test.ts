import { describe, expect, it } from "vite-plus/test";

import { beginSend, sendInFlight } from "./sendsInFlight";

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
