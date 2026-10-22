import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { describeThreadStatus } from "../conversation/status";
import {
  decide,
  firstSeenMark,
  groupOf,
  markFor,
  notificationText,
  type NotifyEvent,
} from "./decide";
import { notifySettingsFor } from "./prefs";

const PRIVATE_TITLE = "Ava Smith's birthday page for St Kilda Primary";
const PRIVATE_TEXT = "my name is Ava Smith, password hunter2, I live at 12 Ferny Road";

function shell(fields: {
  readonly runStatus?: string;
  readonly runId?: string;
  readonly completedAt?: string;
  readonly runtime?: string;
  readonly approval?: string;
  readonly question?: string;
  readonly plan?: boolean;
  readonly stopRequested?: boolean;
  readonly latest?: { readonly role: "assistant" | "user"; readonly text: string };
}): EnvironmentThreadShell {
  const request = fields.approval ?? fields.question;
  return {
    title: PRIVATE_TITLE,
    hasPendingApprovals: fields.approval !== undefined,
    hasPendingUserInput: fields.question !== undefined,
    hasActionableProposedPlan: fields.plan === true,
    runtime: fields.runtime ? { status: fields.runtime } : null,
    latestRun: fields.runStatus
      ? {
          runId: fields.runId ?? "run-1",
          status: fields.runStatus,
          completedAt: fields.completedAt ?? "2026-10-23T09:00:00.000Z",
        }
      : null,
    lastVisitedAt: "2026-10-23T08:00:00.000Z",
    source: {
      latestRunStopRequested: fields.stopRequested ?? false,
      latestVisibleMessage: fields.latest ?? { role: "user", text: PRIVATE_TEXT },
      pendingRuntimeRequest:
        request === undefined
          ? null
          : { id: request, kind: "approval", createdAt: "2026-10-23T09:00:00.000Z" },
    },
  } as unknown as EnvironmentThreadShell;
}

const mark = (fields: Parameters<typeof shell>[0]) => {
  const s = shell(fields);
  return markFor(s, describeThreadStatus(s));
};

/** The event the move from `before` to `after` pings for. */
const moving = (before: Parameters<typeof shell>[0], after: Parameters<typeof shell>[0]) =>
  decide(mark(before), mark(after));

describe("which moments notify", () => {
  it("pings once when the crew finishes", () => {
    const working = { runStatus: "running", runtime: "running" };
    const done = { runStatus: "completed" };
    expect(moving(working, done)).toBe("finished");
    expect(moving(done, done)).toBeNull();
    // A later run finishing pings again.
    expect(
      moving(done, {
        runStatus: "completed",
        runId: "run-2",
        completedAt: "2026-10-23T10:00:00.000Z",
      }),
    ).toBe("finished");
  });

  it("never pings for what was already true when the page opened", () => {
    expect(decide(undefined, mark({ runStatus: "completed" }))).toBeNull();
    expect(decide(undefined, mark({ runStatus: "running", approval: "req-1" }))).toBeNull();
  });

  it("counts a conversation started while watching from nothing, so a quick finish still pings", () => {
    const opened = Date.parse("2026-10-23T08:59:00.000Z");
    const born = firstSeenMark("2026-10-23T08:59:30.000Z", opened);
    expect(decide(born, mark({ runStatus: "completed" }))).toBe("finished");
    expect(firstSeenMark("2026-10-23T08:00:00.000Z", opened)).toBeUndefined();
  });

  it("pings for each step that needs an OK, a question and a ready plan", () => {
    const working = { runStatus: "running", runtime: "running" };
    expect(moving(working, { ...working, approval: "req-1" })).toBe("needs-ok");
    // The same ask again is not news; the next one is.
    expect(moving({ ...working, approval: "req-1" }, { ...working, approval: "req-1" })).toBeNull();
    expect(moving({ ...working, approval: "req-1" }, { ...working, approval: "req-2" })).toBe(
      "needs-ok",
    );
    expect(moving(working, { ...working, question: "req-3" })).toBe("question");
    expect(moving(working, { runStatus: "completed", plan: true })).toBe("plan");
  });

  it("counts a plain-message question as a question, not as finished", () => {
    expect(
      moving(
        { runStatus: "running", runtime: "running" },
        {
          runStatus: "completed",
          latest: { role: "assistant", text: "Which colour would you like for the cat?" },
        },
      ),
    ).toBe("question");
  });

  it("pings when something goes wrong, and not when the person pressed Stop", () => {
    const working = { runStatus: "running", runtime: "running" };
    expect(moving(working, { runStatus: "failed" })).toBe("failed");
    expect(moving(working, { runStatus: "interrupted" })).toBeNull();
    expect(moving(working, { runStatus: "completed", stopRequested: true })).toBeNull();
  });

  it("keeps the ask's id so a Family card can be judged", () => {
    expect(mark({ runStatus: "running", runtime: "running", approval: "req-9" }).requestId).toBe(
      "req-9",
    );
    expect(
      mark({ runStatus: "running", runtime: "running", question: "req-9" }).requestId,
    ).toBeNull();
  });

  it("files every moment under one of the three switches", () => {
    const groups = (
      ["finished", "plan", "needs-ok", "needs-grown-up", "question", "failed"] as const
    ).map(groupOf);
    expect(groups).toEqual(["finished", "needsOk", "needsOk", "needsOk", "needsOk", "failed"]);
  });
});

describe("what a notification says", () => {
  const events: ReadonlyArray<NotifyEvent> = [
    "finished",
    "plan",
    "needs-ok",
    "needs-grown-up",
    "question",
    "failed",
  ];

  it("names the crew and the project", () => {
    expect(notificationText("needs-ok", { builder: "Sam", project: "Ava's makes" }).title).toBe(
      "Sam needs your OK in Ava's makes",
    );
    expect(notificationText("needs-grown-up", { builder: "Sam", project: "Ava's makes" })).toEqual({
      title: "Sam needs a grown-up in Ava's makes",
      body: "A step is waiting for the parent code.",
    });
    expect(notificationText("finished", { builder: "Sam", project: "Space game" }).title).toBe(
      "Sam's finished in Space game",
    );
    expect(notificationText("plan", { builder: "Sam", project: "Space game" }).title).toBe(
      "Sam has a plan for Space game",
    );
    expect(notificationText("failed", { builder: "Crew", project: null })).toEqual({
      title: "Something went wrong",
      body: "Crew stopped. Open it to try again.",
    });
  });

  it("never carries the message, the conversation title or personal details", () => {
    // The only inputs are the crew's name and the project's name; a shell full of private
    // words can reach a notification through neither.
    for (const event of events) {
      const text = notificationText(event, { builder: "Sam", project: "Space game" });
      const shown = `${text.title} ${text.body}`;
      for (const secret of ["Ava Smith", "St Kilda", "hunter2", "Ferny Road", "birthday"]) {
        expect(shown).not.toContain(secret);
      }
    }
  });
});

describe("notification switches", () => {
  const unset = { finished: null, needsOk: null, failed: null, sound: null } as const;

  it("are on for a Family profile and off otherwise; the sound is always off to start", () => {
    expect(notifySettingsFor(unset, true)).toEqual({
      finished: true,
      needsOk: true,
      failed: true,
      sound: false,
    });
    expect(notifySettingsFor(unset, false)).toEqual({
      finished: false,
      needsOk: false,
      failed: false,
      sound: false,
    });
  });

  it("keep what someone chose", () => {
    expect(notifySettingsFor({ ...unset, finished: "off", sound: "on" }, true)).toEqual({
      finished: false,
      needsOk: true,
      failed: true,
      sound: true,
    });
  });
});
