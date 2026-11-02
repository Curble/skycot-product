import { describe, expect, it } from "vite-plus/test";

import { CONNECTION_GRACE_MS, isGracePhase, waitedPastGrace } from "./ConnectionBanner";

describe("connection banner grace", () => {
  it("treats a normal connect or reconnect as a grace phase", () => {
    expect(isGracePhase("connecting")).toBe(true);
    expect(isGracePhase("reconnecting")).toBe(true);
    expect(isGracePhase("available")).toBe(true);
  });

  it("shows real failures at once", () => {
    expect(isGracePhase("offline")).toBe(false);
    expect(isGracePhase("error")).toBe(false);
    expect(isGracePhase("unsupported")).toBe(false);
    expect(isGracePhase("connected")).toBe(false);
  });

  it("stays quiet until the grace period has passed", () => {
    expect(waitedPastGrace(1000, 1000)).toBe(false);
    expect(waitedPastGrace(1000, 1000 + CONNECTION_GRACE_MS - 1)).toBe(false);
    expect(waitedPastGrace(1000, 1000 + CONNECTION_GRACE_MS)).toBe(true);
  });
});
