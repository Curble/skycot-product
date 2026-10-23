import { describe, expect, it } from "vite-plus/test";

import { parseRelayStatus, relaySummary } from "./relay";

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

describe("SKYCOT Relay in the Family settings", () => {
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
