import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isAssistantPlumbing, withoutAssistantPlumbing } from "./plumbing";

const item = (fields: Record<string, unknown>) => fields as unknown as OrchestrationV2TurnItem;

describe("assistant plumbing", () => {
  it("hides Claude's plan-mode notes and tool look-ups, never the child's work", () => {
    expect(
      isAssistantPlumbing(
        item({
          type: "file_change",
          fileName: "/Users/me/.claude/plans/skycot-family-rules-these-standing-rule.md",
        }),
      ),
    ).toBe(true);
    expect(
      isAssistantPlumbing(
        item({ type: "dynamic_tool", toolName: null, input: { query: "select:ExitPlanMode" } }),
      ),
    ).toBe(true);
    expect(
      isAssistantPlumbing(item({ type: "dynamic_tool", toolName: "ExitPlanMode", input: {} })),
    ).toBe(true);
    // The child's own pages, even a plans.md they asked for, stay.
    expect(isAssistantPlumbing(item({ type: "file_change", fileName: "robot.html" }))).toBe(false);
    expect(isAssistantPlumbing(item({ type: "file_change", fileName: "docs/plans/plan.md" }))).toBe(
      false,
    );
    const kept = item({ type: "file_change", fileName: "robot.html" });
    expect(
      withoutAssistantPlumbing([
        kept,
        item({ type: "file_change", fileName: "/Users/x/.claude/plans/a.md" }),
      ]),
    ).toEqual([kept]);
  });
});
