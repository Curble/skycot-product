import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";
import type { EnvironmentId, OrchestrationV2ThreadProjection, ThreadId } from "@t3tools/contracts";

vi.mock("../../app/useChildView", () => ({ useChildView: () => true }));
vi.mock("../../themes/useCrew", () => ({ useCrew: () => ({ builder: { name: "Pip" } }) }));

import { items } from "../../plain/fixtures.test-helpers";
import { WorkingCard } from "./WorkingCard";
import { groupTimelineItems } from "./cards/grouping";

describe("finished plan work in the child view", () => {
  it("calls it a plan, even though the plan has its own separate timeline card", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const turnItems = [items.reasoning("Thinking about the steps"), items.plan("1. Make the page")];
    const projection = {
      turnItems,
      runtimeRequests: [],
      checkpoints: [],
      messages: [],
      runs: [{ id: "run-1", status: "completed", sourcePlanRef: null }],
    } as unknown as OrchestrationV2ThreadProjection;
    const group = groupTimelineItems(turnItems).find((entry) => entry.kind === "work")!;
    try {
      await act(async () =>
        root.render(
          <WorkingCard
            group={group}
            projection={projection}
            environmentId={"env" as EnvironmentId}
            threadId={"thread-1" as ThreadId}
            projectName="My project"
          />,
        ),
      );
      expect(host.textContent).toContain("Pip made a plan");
      expect(host.textContent).toContain("Press Build it");
      expect(host.textContent).not.toContain("All done");
      expect(host.textContent).not.toContain("Nothing in the project was changed");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
