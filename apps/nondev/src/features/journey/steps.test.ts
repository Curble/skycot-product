import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

import { journeyFromItems } from "./steps";

const item = (runId: string, fields: Record<string, unknown>) =>
  ({ runId, ...fields }) as unknown as OrchestrationV2TurnItem;

const planRun = [
  item("plan", { type: "user_message", text: "make a maze" }),
  item("plan", { type: "command_execution", input: "/bin/zsh -lc 'ls -la'" }),
];
const plan = item("plan", {
  type: "proposed_plan",
  markdown:
    "1. Draw the maze\n2. Add the penguin\n3. Add the fish\n4. Keep score\n5. Play again\n6. Check it",
});

describe("Build Journey steps", () => {
  it("thinks, then plans, while Sam writes the plan (looking around is not testing)", () => {
    expect(journeyFromItems(planRun).now).toBe("Think it through");
    expect(journeyFromItems([...planRun, plan]).now).toBe("Make a plan");
  });

  it("builds, then tests only for checks after files changed, in the current run", () => {
    const build = [
      ...planRun,
      plan,
      item("build", { type: "user_message", text: "Build it: go ahead with the plan." }),
      item("build", { type: "command_execution", input: "cat AGENTS.md" }),
    ];
    expect(journeyFromItems(build).now).toBe("Build it");
    const written = [
      ...build,
      item("build", { type: "file_change", fileName: "my-game.html", additions: 156 }),
    ];
    expect(journeyFromItems(written).now).toBe("Build it");
    const checked = [
      ...written,
      item("build", { type: "command_execution", input: "node check.js" }),
    ];
    const journey = journeyFromItems(checked, "Sam");
    expect(journey.now).toBe("Test it");
    expect(journey.steps.map((step) => step.state)).toEqual([
      "done",
      "done",
      "done",
      "now",
      "next",
    ]);
    expect(journey.facts).toEqual([
      "Sam made 6 steps",
      "Sam wrote 1 page with 156 lines",
      "Sam checked the work 1 time",
    ]);
    expect(journeyFromItems(checked, "Sam", true).now).toBe("Finish");
  });

  it("starts over for the next request in the same conversation", () => {
    const earlier = [
      ...planRun,
      plan,
      item("build", { type: "file_change", fileName: "my-game.html", additions: 10 }),
      item("build", { type: "command_execution", input: "node check.js" }),
    ];
    const next = [...earlier, item("tweak", { type: "user_message", text: "make it blue" })];
    // A follow-up after a plan was made earlier goes straight to building.
    expect(journeyFromItems(next).now).toBe("Build it");
  });
});
