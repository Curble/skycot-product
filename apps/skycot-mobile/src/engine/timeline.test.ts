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
});
