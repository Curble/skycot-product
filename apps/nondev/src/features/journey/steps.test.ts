import { describe, expect, it } from "vite-plus/test";
import { journeyFromItems } from "./steps";
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

describe("Build Journey steps", () => {
  it("moves from planning into building, checking, and finishing from real items", () => {
    const items = [
      { type: "proposed_plan", steps: [] },
      { type: "todo_list", steps: [{}, {}, {}, {}, {}, {}] },
      { type: "file_change", fileName: "index.html", additions: 156 },
      { type: "command_execution", input: "node check.js" },
    ] as unknown as OrchestrationV2TurnItem[];
    expect(journeyFromItems(items, "Sam").now).toBe("Test it");
    expect(journeyFromItems(items, "Sam").facts).toEqual([
      "Sam made 6 steps",
      "Sam wrote 1 page with 156 lines",
      "Sam checked the work 1 time",
    ]);
    expect(journeyFromItems(items, "Sam", true).now).toBe("Finish");
  });
});
