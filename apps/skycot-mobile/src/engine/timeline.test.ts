// nondev-seam: skycot-iphone-q39-timeline-test
import { describe, expect, it } from "vite-plus/test";

import { demoConversation } from "../dev/demoConversation";
import { buildTimeline, isWorking } from "./timeline";

const context = { projectRoot: "/Users/family/SKYCOT/Space game", assistantName: "Sam" };

describe("a conversation as SKYCOT's cards", () => {
  it("shows a plan waiting for Build it", () => {
    const entries = buildTimeline(demoConversation("plan"), context);
    expect(entries.map((entry) => entry.kind)).toEqual(["me", "plan"]);
    expect(entries[1]).toMatchObject({ kind: "plan", state: "ready" });
  });

  it("shows a provider question and its answer choices as a child card", () => {
    const projection = demoConversation("plan");
    const question = {
      ...(projection.turnItems[0] as never),
      id: "question-item",
      position: 9,
      item: {
        type: "user_input_request",
        id: "question-item",
        requestId: "request-1",
        questions: [
          {
            id: "q1",
            header: "Colour",
            question: "Which colour should I use?",
            options: [
              { label: "Blue", description: "Blue", value: "blue" },
              { label: "Green", description: "Green", value: "green" },
            ],
          },
        ],
      },
    } as never;
    const entries = buildTimeline({ ...projection, visibleTurnItems: [question] }, context);
    expect(entries).toContainEqual(
      expect.objectContaining({
        kind: "question",
        question: "Which colour should I use?",
        options: [
          { label: "Blue", value: "blue" },
          { label: "Green", value: "green" },
        ],
      }),
    );
  });

  it("turns an allowance limit into a rest card with the return time", () => {
    const projection = demoConversation("made");
    const prior = projection.visibleTurnItems[0]!;
    const error = {
      position: 10,
      item: {
        ...prior.item,
        type: "error",
        id: "limit-error",
        failure: { class: "usage_limit", resetAt: "2026-10-27T10:00:00.000Z" },
      },
    } as never;
    expect(buildTimeline({ ...projection, visibleTurnItems: [error] }, context)).toContainEqual(
      expect.objectContaining({
        kind: "oops",
        text: "Sam needs a short rest.",
        isRest: true,
        restUntil: "2026-10-27T10:00:00.000Z",
      }),
    );
  });

  it("holds an install for a grown-up, and lets the child answer an ordinary read", () => {
    const projection = demoConversation("ask");
    expect(isWorking(projection)).toBe(true);
    const asks = buildTimeline(projection, context).filter((entry) => entry.kind === "ask");
    expect(asks).toHaveLength(2);
    expect(asks[0]).toMatchObject({ state: "allowed" });
    const install = asks[1]!;
    expect(install.kind === "ask" && install.state).toBe("waiting");
    expect(install.kind === "ask" && install.card.grownUp).toMatch(/internet/u);
    // Never "for the session" or "always" on a child's card.
    expect(
      install.kind === "ask" &&
        install.card.options.some(
          (option) =>
            "decision" in option.decision &&
            (option.decision.decision === "acceptForSession" ||
              option.decision.decision === "acceptAlways"),
        ),
    ).toBe(false);
  });

  it("says what changed in plain words, with Undo back to before", () => {
    const changed = buildTimeline(demoConversation("made"), context).find(
      (entry) => entry.kind === "changed",
    );
    expect(changed).toMatchObject({ kind: "changed", fileCount: 2, undone: false });
    expect(changed?.kind === "changed" && changed.undo).not.toBeNull();
    expect(JSON.stringify(changed)).not.toMatch(/space-game\.html|rocket\.css/u);
  });

  it("hides safe step cards and developer change details from a child", () => {
    const asks = buildTimeline(demoConversation("ask"), { ...context, childView: true });
    expect(asks.some((entry) => entry.kind === "ask" && entry.state === "allowed")).toBe(false);
    const entries = buildTimeline(demoConversation("made"), { ...context, childView: true });
    expect(entries.find((entry) => entry.kind === "changed")).toMatchObject({
      headline: "Sam made your page.",
      lines: ["Your page is ready to play."],
      kidSummary: true,
    });
  });

  it("shows one plain, retryable failure until the child sends another message", () => {
    const projection = demoConversation("plan");
    const visible = projection.visibleTurnItems as unknown as Array<{
      readonly position: number;
      readonly item: Record<string, unknown>;
    }>;
    const user = visible[0]!.item;
    const failed = {
      ...user,
      id: "turn-item:failed",
      type: "error",
      failure: {
        class: "transport_error",
        message: "socket broke",
        code: null,
        retryable: true,
        resetAt: null,
      },
    };
    (projection as unknown as { visibleTurnItems: unknown }).visibleTurnItems = [
      visible[0]!,
      { position: 2, item: failed },
    ];
    expect(buildTimeline(projection, context).at(-1)).toMatchObject({
      kind: "oops",
      text: "The Mac lost its connection for a moment.",
      retryText: user.text,
    });
    (projection as unknown as { visibleTurnItems: unknown }).visibleTurnItems = [
      visible[0]!,
      { position: 2, item: failed },
      { position: 3, item: { ...user, id: "turn-item:retry", text: "Try again" } },
    ];
    expect(buildTimeline(projection, context).some((entry) => entry.kind === "oops")).toBe(false);
  });

  it("hides inline SKYCOT starter instructions from both sides of the conversation", () => {
    const projection = demoConversation("plan");
    const visible = projection.visibleTurnItems as unknown as Array<{
      readonly position: number;
      readonly item: Record<string, unknown>;
    }>;
    const user = { ...visible[0]!.item, text: "Make a pet [SKYCOT: starter pet] please" };
    (projection as unknown as { visibleTurnItems: unknown }).visibleTurnItems = [
      { position: 0, item: user },
    ];
    expect(buildTimeline(projection, context)[0]).toMatchObject({
      kind: "me",
      text: "Make a pet please",
    });
  });
});
