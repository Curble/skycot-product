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
