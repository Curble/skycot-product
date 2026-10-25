import { describe, expect, it } from "vite-plus/test";

import { linkNeedsRelayStep, parseRelayStatus, reachableLink, relaySummary } from "./relay";

const status = (state: string, extra: Record<string, unknown> = {}) =>
  parseRelayStatus({
    available: true,
    enabled: true,
    state,
    relayHost: "relay.skycot.com",
    devicesLinked: 2,
    devicesOnline: 1,
    ...extra,
  });

// nondev-seam: skycot-family-reachable-link-test
describe("SKYCOT Relay in the Family settings", () => {
  it("never picks an unreachable address for a phone's QR code", () => {
    const unreachable = { reachable: false, url: "http://localhost/simple/#token=secret" };
    expect(reachableLink([unreachable])).toBeNull();
    expect(
      reachableLink([unreachable, { reachable: true, url: "https://relay/simple/#token=secret" }]),
    ).toEqual({ reachable: true, url: "https://relay/simple/#token=secret" });
  });

  it("asks for the relay only when it is off and no link address is reachable", () => {
    expect(linkNeedsRelayStep(status("off", { enabled: false }), [])).toBe(true);
    expect(
      linkNeedsRelayStep(status("not-available", { available: false, enabled: false }), []),
    ).toBe(true);
    expect(linkNeedsRelayStep(status("off", { enabled: false }), [{ reachable: true }])).toBe(
      false,
    );
    expect(linkNeedsRelayStep(status("connected"), [])).toBe(false);
    expect(linkNeedsRelayStep(null, [])).toBe(false);
  });

  it("cannot be switched on in a build without a relay", () => {
    const summary = relaySummary(
      parseRelayStatus({ available: false, enabled: false, state: "not-available" }),
    );
    expect(summary.switchDisabled).toBe(true);
    expect(summary.switchOn).toBe(false);
  });

  it("says plainly what each state means for the family", () => {
    expect(relaySummary(status("off")).subtitle).toMatch(/only on your home network/);
    expect(relaySummary(status("connected")).subtitle).toMatch(
      /from anywhere\. 1 device is connected/,
    );
    expect(relaySummary(status("unreachable")).badge).toBe("warn");
    expect(relaySummary(status("refused")).badge).toBe("fail");
    expect(relaySummary(null).switchDisabled).toBe(true);
  });

  it("ignores an answer it does not understand", () => {
    expect(parseRelayStatus({ state: "exploded" })).toBeNull();
    expect(parseRelayStatus("nope")).toBeNull();
  });
});
