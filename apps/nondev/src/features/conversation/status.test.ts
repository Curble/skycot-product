import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import {
  asksForReply,
  conversationPreview,
  describeThreadStatus,
  hasReadyCheckpointPill,
  saysRefused,
} from "./status";

function shell(fields: {
  readonly runStatus?: string;
  readonly runtime?: string;
  readonly stopRequested?: boolean;
  readonly latest?: { readonly role: "assistant" | "user"; readonly text: string } | null;
}): EnvironmentThreadShell {
  return {
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    runtime: fields.runtime ? { status: fields.runtime } : null,
    latestRun: fields.runStatus
      ? { runId: "run-1", status: fields.runStatus, completedAt: "2026-10-21T09:00:00.000Z" }
      : null,
    lastVisitedAt: "2026-10-21T10:00:00.000Z",
    source: {
      latestRunStopRequested: fields.stopRequested ?? false,
      latestVisibleMessage: fields.latest ?? null,
    },
  } as unknown as EnvironmentThreadShell;
}

describe("asksForReply", () => {
  it("spots a question asked as a plain message", () => {
    expect(asksForReply("Which two dishes should go in the specials box?")).toBe(true);
    expect(
      asksForReply("I read all three pages.\n\nWhich two dishes should go in the specials box?"),
    ).toBe(true);
  });

  it("spots a request for an answer without a question mark", () => {
    expect(asksForReply("Please allow workspace access so I can add the section.")).toBe(true);
    expect(asksForReply("Let me know which colour you'd prefer and I'll carry on.")).toBe(true);
  });

  it("stays quiet for a finished report", () => {
    expect(asksForReply("Done. The footer now shows bookings@littleferncafe.example.")).toBe(false);
    expect(asksForReply("- added the page\n- linked it from the nav")).toBe(false);
    expect(asksForReply("")).toBe(false);
  });

  it("ignores questions buried in code blocks or early in a long reply", () => {
    expect(asksForReply("```\nwhat?\n```\nAll three pages open fine.")).toBe(false);
    expect(
      asksForReply(
        "Is this right? I checked. Then I fixed it. Then I tested it. All good now. Everything works.",
      ),
    ).toBe(false);
  });
});

describe("the finished-build status pill", () => {
  it("uses one checkpoint pill only when the latest build is ready to inspect", () => {
    const ready = {
      ...describeThreadStatus(shell({ runStatus: "completed" })),
      kind: "ready" as const,
    };
    expect(hasReadyCheckpointPill(ready, "checkpoint-1", false)).toBe(true);
    expect(hasReadyCheckpointPill(ready, null, false)).toBe(false);
    expect(hasReadyCheckpointPill(ready, "checkpoint-1", true)).toBe(false);
  });
});

describe("describeThreadStatus after a refusal (QA-P2-2-04)", () => {
  it("reads the Crew's closing statement as a refusal", () => {
    expect(saysRefused("book.html was not deleted—the command approval was rejected.")).toBe(true);
    expect(saysRefused("I didn't push because you declined the request.")).toBe(true);
    expect(saysRefused("Done. The footer now shows the hours.")).toBe(false);
  });

  it("says Stopped — you said no, in the list and with the crew's name", () => {
    const refused = shell({
      runStatus: "completed",
      latest: {
        role: "assistant",
        text: "book.html was not deleted—the command approval was rejected.",
      },
    });
    const status = describeThreadStatus(refused);
    expect(status.headline).toBe("Stopped — you said no");
    expect(status.kind).toBe("stopped");
    expect(conversationPreview(refused, status)).toBe("Crew: Stopped — you said no");
    expect(conversationPreview(refused, status, "Sam")).toBe("Sam: Stopped — you said no");
  });

  it("takes the refusal from the conversation view when the words don't say it", () => {
    const quiet = shell({ runStatus: "completed", latest: { role: "assistant", text: "OK." } });
    expect(describeThreadStatus(quiet).headline).toBe("All done");
    expect(describeThreadStatus(quiet, { refused: true }).headline).toBe("Stopped — you said no");
  });

  it("says Stopping… the moment Stop is pressed, even with an ask still pending", () => {
    const stopping = {
      ...shell({ runStatus: "running", runtime: "running", stopRequested: true }),
      hasPendingApprovals: true,
    } as EnvironmentThreadShell;
    const status = describeThreadStatus(stopping);
    expect(status.headline).toBe("Stopping…");
    expect(status.attention).toBe("none");
    expect(conversationPreview(stopping, status, "Sam")).toBe("Sam: Stopping…");
  });
});

describe("child waiting words", () => {
  it("uses grown-up language for held steps and plans", () => {
    const held = {
      ...shell({ runStatus: "running", runtime: "running" }),
      hasPendingApprovals: true,
    } as EnvironmentThreadShell;
    expect(describeThreadStatus(held, { childView: true }).headline).toBe("Waiting for a grown-up");
    expect(describeThreadStatus(held).headline).toBe(
      "Waiting for you · needs your OK before it carries on",
    );
    const plan = { ...shell({}), hasActionableProposedPlan: true } as EnvironmentThreadShell;
    expect(describeThreadStatus(plan, { childView: true })).toMatchObject({
      kind: "plan",
      headline: "Your plan is ready",
    });
    expect(
      describeThreadStatus(shell({ runStatus: "completed" }), { childView: true }).kind,
    ).not.toBe("plan");
  });
});
