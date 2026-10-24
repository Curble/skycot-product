import { assert, describe, it } from "@effect/vitest";

import { approvalNotifications } from "./approvalNotifications.ts";

describe("approvalNotifications", () => {
  // nondev-seam: skycot-approval-lapse-notifications-test
  it("sends a second nudge when a held approval first lapses", () => {
    const before = { requests: new Set(["req-1"]), lapsed: new Set<string>() };
    const transition = approvalNotifications([{ requestId: "req-1", lapsed: true }], before);
    assert.deepEqual(transition.fresh, []);
    assert.deepEqual(
      transition.newlyLapsed.map((request) => request.requestId),
      ["req-1"],
    );
    assert.deepEqual(
      approvalNotifications([{ requestId: "req-1", lapsed: true }], {
        ...before,
        lapsed: new Set(["req-1"]),
      }).newlyLapsed,
      [],
    );
  });

  it("does not nudge after a restart about requests that lapsed long ago", () => {
    const afterRestart = { requests: new Set<string>(), lapsed: new Set<string>() };
    assert.deepEqual(
      approvalNotifications([{ requestId: "old", lapsed: true }], afterRestart).newlyLapsed,
      [],
    );
  });
});
