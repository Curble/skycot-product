// nondev-seam: skycot-iphone-q39-about-copy-test
import { describe, expect, it } from "vite-plus/test";

import { CHILD_ABOUT_COPY } from "./aboutCopy";

describe("About SKYCOT for a child", () => {
  it("explains Sam and privacy in short, kind words", () => {
    expect(CHILD_ABOUT_COPY.title).toBe("About SKYCOT");
    expect(CHILD_ABOUT_COPY.sam).toContain("AI helper");
    expect(CHILD_ABOUT_COPY.privacy).toContain("stays on your family's Mac");
    expect(CHILD_ABOUT_COPY).not.toHaveProperty("ask");
    expect(JSON.stringify(CHILD_ABOUT_COPY)).not.toMatch(/tailscale|licen[cs]e|tracking/iu);
  });
});
