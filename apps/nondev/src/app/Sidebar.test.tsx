import { describe, expect, it, vi } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ChildMakesList,
  childMakeBadge,
  nextChildProjectName,
  ProfileMenu,
  SidebarIdentity,
} from "./Sidebar";
import type { FamilyChild } from "../features/family/children";
import type { ConversationRow } from "../state/conversations";

const child: FamilyChild = {
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

describe("Sidebar identity in the child view", () => {
  it("shows the child's identity and switch action", () => {
    const html = renderToStaticMarkup(
      <ProfileMenu
        childView
        child={child}
        grownUp={null}
        onSwitch={vi.fn()}
        onChildSettings={vi.fn()}
        onSettings={vi.fn()}
        onHelp={vi.fn()}
        onHandBack={vi.fn()}
      />,
    );
    expect(html).toContain("Ava");
    // The name tag is the way to switch (its menu opens on press).
    expect(html).toContain("fm-nametag");
    expect(html).toContain("my name is");
    expect(html).not.toContain("Grown-up mode");
  });

  it("renders one merged makes list with status badges and an expand action", () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      title: `Make ${index + 1}`,
      at: new Date(Date.now() - index * 86_400_000).toISOString(),
      status:
        index === 0
          ? { kind: "ready" }
          : index === 1
            ? { kind: "waiting", headline: "Waiting for a grown-up" }
            : { kind: "working" },
      shell: { id: `thread-${index}`, environmentId: "env" },
    })) as unknown as ReadonlyArray<ConversationRow>;
    const html = renderToStaticMarkup(<ChildMakesList rows={rows} onOpen={vi.fn()} />);
    expect(html).toContain("Things I made");
    expect(html).toContain("Ready to look at");
    expect(html).toContain("Waiting for a grown-up");
    expect(html).toContain("Building now");
    expect(html).toContain("Show all 7 makes");
    expect(html).not.toContain("Projects");
    expect(html).not.toContain("Your crew");
    expect(html).not.toContain("Make 7");
  });

  it("labels child makes by the step they are waiting on", () => {
    const now = new Date().toISOString();
    expect(childMakeBadge({ kind: "waiting", headline: "Waiting for a grown-up" }, now)).toBe(
      "Waiting for a grown-up",
    );
    expect(
      childMakeBadge({ kind: "waiting", headline: "Sam made a plan. Press Build it." }, now),
    ).toBe("Press Build it");
    expect(
      childMakeBadge({ kind: "waiting", headline: "Waiting for you · has a question" }, now),
    ).toBe("A question for you");
  });

  it("chooses the next unused child project name", () => {
    expect(nextChildProjectName(["Questions", "Project 1", "Project 2"])).toBe("Project 3");
  });

  it("keeps the grown-up footer label", () => {
    const html = renderToStaticMarkup(
      <SidebarIdentity familyOn childView={false} child={null} onSwitch={vi.fn()} />,
    );
    expect(html).toContain("Grown-up");
  });

  it("shows the grown-up's own name while they are using the family's Mac", () => {
    const html = renderToStaticMarkup(
      <SidebarIdentity
        familyOn
        childView={false}
        child={null}
        grownUp={{ name: "Mum", avatar: { kind: "character", id: "cat" } }}
        onSwitch={vi.fn()}
      />,
    );
    expect(html).toContain("Mum");
    expect(html).not.toContain("Grown-up");
  });
});
