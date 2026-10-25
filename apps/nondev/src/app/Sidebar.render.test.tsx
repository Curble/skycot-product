// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

const fixture = vi.hoisted(() => ({ childView: true, rows: [] as unknown[] }));
const child = {
  id: "ava",
  name: "Ava",
  avatar: { kind: "mascot", pose: "hello" },
  look: "paper",
  largerText: false,
  voice: { typing: false, readAloud: true },
  limits: { bedtime: null, dailyMinutes: null, dailyTurns: null, keepAllowancePercent: null },
  askEachStep: false,
  readingLevel: "makers",
};

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === "conversation-rows" ? fixture.rows : atom === "archived-rows" ? [] : [],
}));
vi.mock("../state/catalog", () => ({ enabledEnvironmentIdsAtom: "environment-ids" }));
vi.mock("../state/conversations", () => ({
  conversationRowsAtom: "conversation-rows",
  projectKeyOf: () => "project-key",
}));
vi.mock("../state/projects", () => ({ environmentProjects: { projectsAtom: "projects" } }));
vi.mock("../state/oldConversations", () => ({ oldConversationRowsAtom: "archived-rows" }));
vi.mock("./ShellState", () => ({
  useShellState: () => ({
    filter: "all",
    projectKey: null,
    setFilter: vi.fn(),
    setProjectKey: vi.fn(),
  }),
}));
vi.mock("./SidebarSheets", () => ({
  useSidebarSheets: () => ({
    openFolder: vi.fn(),
    editProject: vi.fn(),
    openChildSettings: vi.fn(),
    openAdvanced: vi.fn(),
  }),
}));
vi.mock("../themes/useCrew", () => ({
  useCrew: () => ({ named: true, builder: { name: "Sam" }, checker: { name: "Mo" } }),
}));
vi.mock("../features/family/FamilyProvider", () => ({
  useFamily: () => ({
    enabled: fixture.childView,
    profile: {
      me: { kind: fixture.childView ? "child" : "grown-up" },
      currentChildId: "ava",
      children: [child],
    },
  }),
}));
vi.mock("../features/family/family", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/family/family")>()),
  currentChild: () => (fixture.childView ? child : null),
}));
// The child check reads the grown-up session; in these tests the fixture decides.
vi.mock("./useChildView", () => ({ useChildView: () => fixture.childView }));
vi.mock("../features/family-limits/FamilyLimitsHost", () => ({ openChildPicker: vi.fn() }));

import { AppSidebar } from "./Sidebar";

function makeRow(index: number) {
  return {
    title: `Make ${index}`,
    at: new Date(Date.now() - index * 86_400_000).toISOString(),
    status: { kind: index === 1 ? "ready" : "working", attention: "none" },
    shell: { id: `thread-${index}`, environmentId: "environment" },
    projectKey: "project-key",
  };
}

async function mounted(insideMake = true) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <AppSidebar
        route={
          insideMake
            ? {
                name: "thread",
                environmentId: "environment" as EnvironmentId,
                threadId: "thread-0" as ThreadId,
              }
            : { name: "home" }
        }
        insideMake={insideMake}
      />,
    ),
  );
  return {
    host,
    async click(label: string) {
      const button = [...host.querySelectorAll("button")].find(
        (element) =>
          element.getAttribute("aria-label") === label || element.textContent?.includes(label),
      );
      if (!button) throw new Error(`No button found for ${label}`);
      await act(async () => button.click());
    },
    async key(key: string) {
      await act(async () =>
        document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })),
      );
    },
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    },
  };
}

afterEach(() => {
  fixture.childView = true;
  fixture.rows = [];
});

describe("child sidebar and make rail", () => {
  it("shows the merged makes, badges, and child-only navigation", async () => {
    fixture.childView = true;
    fixture.rows = Array.from({ length: 8 }, (_, index) => makeRow(index));
    const page = await mounted(false);
    expect(page.host.textContent).toContain("My makes");
    expect(page.host.textContent).toContain("Ready to look at");
    expect(page.host.textContent).toContain("Building now");
    expect(page.host.textContent).toContain("Show all 8 makes");
    expect(page.host.textContent).not.toContain("All conversations");
    expect(page.host.textContent).not.toContain("Projects");
    expect(page.host.textContent).not.toContain("Your crew");
    await page.unmount();
  });

  it("opens the full sidebar from the rail and closes it with Escape", async () => {
    fixture.childView = true;
    const page = await mounted();
    expect(page.host.querySelector(".fm-child-rail")).not.toBeNull();
    await page.click("Show sidebar");
    expect(page.host.querySelector(".fm-sidebar--child-overlay")).not.toBeNull();
    await page.key("Escape");
    expect(page.host.querySelector(".fm-sidebar--child-overlay")).toBeNull();
    expect(page.host.querySelector(".fm-child-rail")).not.toBeNull();
    await page.unmount();
  });

  it("keeps the grown-up sidebar sections", async () => {
    fixture.childView = false;
    const page = await mounted(false);
    expect(page.host.textContent).toContain("All conversations");
    expect(page.host.textContent).toContain("Projects");
    expect(page.host.textContent).toContain("Your crew");
    await page.unmount();
  });
});
