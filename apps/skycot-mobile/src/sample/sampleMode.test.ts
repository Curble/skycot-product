// Entering and leaving the sample family.
import { describe, expect, it } from "vite-plus/test";

import { modeOf } from "../links/pairing";
import type { Mac } from "../links/store";
import { sampleMacId } from "./fixtures";
import { canEnterSample, createSampleMac, isSampleMac, macsToShow } from "./sampleMode";
import { SAMPLE_BANNER_TEXT, switchViewLabel } from "./sampleCopy";

const real = [{ macId: "real-mac", macName: "MamaBear" }] as unknown as ReadonlyArray<Mac>;

describe("entering the sample", () => {
  it("is offered only on a device with no real Mac", () => {
    expect(canEnterSample(0)).toBe(true);
    expect(canEnterSample(1)).toBe(false);
  });

  it("shows the sample alone, as a grown-up's phone or as Ava's device", () => {
    const phone = createSampleMac("grown-up");
    const ipad = createSampleMac("child");
    expect(macsToShow([], phone)).toEqual([phone]);
    expect(modeOf(macsToShow([], phone))).toBe("grown-up");
    expect(modeOf(macsToShow([], ipad))).toBe("child");
    expect(isSampleMac(phone)).toBe(true);
    expect(phone.macId).toBe(sampleMacId("grown-up"));
    expect(phone.macId).not.toBe(ipad.macId);
  });

  it("is labelled a sample everywhere it shows its name", () => {
    expect(createSampleMac("grown-up").macName).toBe("Sample family");
    expect(SAMPLE_BANNER_TEXT).toBe(
      "Sample family — nothing here is real. Link your Mac to use SKYCOT.",
    );
    expect(switchViewLabel("child")).toContain("Ava");
  });
});

describe("leaving the sample", () => {
  it("brings back exactly the really linked Macs, and a fresh sample holds nothing old", async () => {
    const first = createSampleMac("grown-up");
    expect(macsToShow(real, null)).toBe(real);
    expect(macsToShow([], null)).toEqual([]);
    expect(modeOf(macsToShow([], null))).toBe("unlinked");
    // A writes counter lives on the transport, which is dropped with the Mac.
    await first.transport.request({ method: "POST", path: "/api/skycot/family/approver/lock-all" });
    const again = createSampleMac("grown-up");
    expect((again.transport as unknown as { acknowledged(): string[] }).acknowledged()).toEqual([]);
    expect(again.transport).not.toBe(first.transport);
  });
});
