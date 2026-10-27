// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  child: false,
  requireParentCode: vi.fn(async () => true),
  dispatch: vi.fn(async () => null),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({ workspaceRoot: "/Users/ava/Projects/fonts" }),
}));
vi.mock("~/state/query", () => ({ useEnvironmentQuery: () => ({ data: undefined }) }));
vi.mock("../../../state/projects", () => ({ projectAtomOrEmpty: () => ({}) }));
vi.mock("../../../state/vcs", () => ({ vcsEnvironment: { status: vi.fn() } }));
vi.mock("../../../themes/useCrew", () => ({
  useCrew: () => ({ named: false, builder: { name: "Sam" } }),
}));
vi.mock("../../../app/useChildView", () => ({ useChildView: () => state.child }));
vi.mock("../../family/FamilyProvider", () => ({
  useFamily: () => ({
    enabled: true,
    profile: {
      childName: "Ava",
      me: { kind: "shared" },
      devices: [],
      grownUps: [],
      children: [],
      trustedAddOns: false,
    },
    requireParentCode: state.requireParentCode,
  }),
  useFamilySteps: () => ({ askEachStep: true }),
}));
vi.mock("./dispatch", () => ({ useDecisionDispatcher: () => state.dispatch }));
vi.mock("../useGrownUpAnswers", () => ({ useGrownUpAnswers: () => new Map() }));

import { items } from "../../../plain/fixtures.test-helpers";
import { RequestCard } from "./RequestCard";

afterEach(() => {
  state.child = false;
  state.requireParentCode.mockClear();
  state.dispatch.mockClear();
});

describe("grown-up command card project approval", () => {
  it("keeps an outside file path out of the child card", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.child = true;
    const path = "/Users/ava/.claude/projects/-Users-ava-Projects-demo/memory/MEMORY.md";
    const item = items.approval("file-read", { prompt: `Read ${path}` });
    const projection = {
      turnItems: [item],
      runtimeRequests: [
        { id: item.requestId, status: "pending", responseCapability: { type: "resumable" } },
      ],
      runs: [],
    } as never;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <RequestCard
          item={item}
          context={{
            item,
            index: 0,
            items: [item],
            projection,
            environmentId: "env-1" as never,
            threadId: "thread-1" as never,
            shell: { projectId: "project-1", runtimeMode: "approval-required" } as never,
            projectName: "demo",
          }}
        />,
      ),
    );
    expect(host.textContent).toContain("read a file outside your project");
    expect(host.textContent).not.toContain(path);
    await act(async () => root.unmount());
    host.remove();
  });

  it("shows the project option for the wrapped Lobster font request and sends project scope", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const command =
      "/bin/zsh -lc 'curl -fL https://raw.githubusercontent.com/google/fonts/main/ofl/lobster/Lobster-Regular.ttf -o Lobster-Regular.ttf'";
    const ref = { driver: "codex", nativeId: "font-download", strength: "strong" } as const;
    const item = items.approval("command", { prompt: command }, { nativeItemRef: ref as never });
    const call = items.command(command, {}, { nativeItemRef: ref as never });
    const projection = {
      turnItems: [item, call],
      runtimeRequests: [
        {
          id: item.requestId,
          status: "pending",
          responseCapability: { type: "resumable" },
        },
      ],
      runs: [],
    } as never;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <RequestCard
          item={item}
          context={{
            item,
            index: 0,
            items: [item, call],
            projection,
            environmentId: "env-1" as never,
            threadId: "thread-1" as never,
            shell: {
              projectId: "project-1",
              title: "Lobster page",
              runtimeMode: "approval-required",
            } as never,
            projectName: "fonts",
          }}
        />,
      ),
    );
    expect(host.textContent).toContain(
      "Ava's page wants to download the Lobster Regular font from GitHub's files.",
    );
    const projectButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Allow for this project",
    );
    expect(projectButton).toBeDefined();
    await act(async () => projectButton!.click());
    expect(state.requireParentCode).toHaveBeenCalledWith(
      "approve",
      expect.objectContaining({ requestId: item.requestId, scope: "project" }),
    );
    expect(state.dispatch).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    host.remove();
  });
});
