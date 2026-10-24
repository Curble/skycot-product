import { describe, expect, it, vi } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";

import { SidebarIdentity } from "./Sidebar";
import type { FamilyChild } from "../features/family/children";

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
      <SidebarIdentity familyOn childView child={child} onSwitch={vi.fn()} />,
    );
    expect(html).toContain("Ava");
    expect(html).toContain("Switch");
    expect(html).not.toContain("Grown-up");
  });
});
