// nondev-seam: skycot-iphone-q39-conversation-labels-test
// Just ask, one space per child, in the app: a child's own space counts as Questions (so it is
// never listed as a project to pick), and each space is named for whoever holds the device.
import { describe, expect, it } from "vite-plus/test";

import type { ProjectShell } from "../engine/types";
import { childStatusLabel, isQuestionsProject, projectTitleFor, rowLabel } from "./conversations";

const ROOT = "/Users/family/.skycot/scratch";
const AVA = "c0a0a0a0a0a";
const project = (workspaceRoot: string, title: string) =>
  ({ id: title, workspaceRoot, title }) as unknown as ProjectShell;
const SHARED = project(ROOT, "No project");
const AVAS = project(`${ROOT}/children/${AVA}`, "Ava's questions");
const SITE = project("/Users/family/site", "Our site");
const childDevice = { me: { kind: "child", childId: AVA } } as never;
const grownUpPhone = { me: { kind: "grown-up", personId: "g1" } } as never;

describe("Questions spaces in the app", () => {
  it("knows a child's own space and the shared one as Questions, not projects", () => {
    expect(isQuestionsProject(AVAS, ROOT)).toBe(true);
    expect(isQuestionsProject(SHARED, ROOT)).toBe(true);
    expect(isQuestionsProject(SITE, ROOT)).toBe(false);
    expect(isQuestionsProject(project(`${ROOT}/children/${AVA}/2026-10-24-sky`, "x"), ROOT)).toBe(
      false,
    );
  });

  it("a child's device says Questions for theirs, Earlier questions for the shared one", () => {
    expect(projectTitleFor(AVAS, childDevice, ROOT)).toBe("Questions");
    expect(projectTitleFor(SHARED, childDevice, ROOT)).toBe("Earlier questions");
    expect(projectTitleFor(SITE, childDevice, ROOT)).toBe("Our site");
    expect(projectTitleFor(null, childDevice, ROOT)).toBe("A project");
  });

  it("a grown-up's phone shows whose they are, as the Mac titles them", () => {
    expect(projectTitleFor(AVAS, grownUpPhone, ROOT)).toBe("Ava's questions");
    expect(projectTitleFor(AVAS, grownUpPhone, null)).toBe("Ava's questions");
  });
});

describe("a child's conversation status", () => {
  it("labels a child's conversation with its project only", () => {
    const row = { projectTitle: "Our site", mac: { macName: "skycot-wt-device" } } as never;
    expect(rowLabel(row)).toBe("Our site");
  });

  it("uses friendly words while Sam works and when a page is ready", () => {
    expect(childStatusLabel("working", "Sam", false)).toBe("Sam is working");
    expect(childStatusLabel("done", "Sam", true)).toBe("Ready to play");
  });
});
