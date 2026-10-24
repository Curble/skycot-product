import { describe, expect, it } from "vite-plus/test";

import { estimateForRun } from "./runEstimate";

describe("estimateForRun", () => {
  it("calls a run that carries out a plan a build, anything else the plan", () => {
    const model = { model: "gpt-6-luna" };
    expect(estimateForRun({ sourcePlanRef: { planId: "p" }, modelSelection: model }).phase).toBe(
      "build",
    );
    expect(estimateForRun({ modelSelection: model }).phase).toBe("plan");
    expect(estimateForRun(undefined).phase).toBe("plan");
  });
});
