// Just ask, one space per child, in the plain client: what each Questions space is called for
// whoever is looking, and that a child's own space behaves as a Questions space everywhere
// (the compose box, "Make this a project", where a made project's conversation is listed).
import type { OrchestrationProjectShell } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  composeTargetFor,
  isQuestionsProject,
  labelQuestionsSpaces,
  makeProjectOffer,
  projectForConversation,
  realProjects,
  type QuestionsViewer,
} from "./questions";

const ROOT = "/Users/family/.skycot/scratch";
const AVA = "c0a0a0a0a0a";
const LEO = "c1e01e01e01";
const shell = (id: string, workspaceRoot: string, title: string) =>
  ({ id, workspaceRoot, title }) as unknown as OrchestrationProjectShell;
const SHARED = shell("questions", ROOT, "No project");
const AVAS = shell("ava-questions", `${ROOT}/children/${AVA}`, "Ava's questions");
const LEOS = shell("leo-questions", `${ROOT}/children/${LEO}`, "Leo's questions");
const SITE = shell("site", "/Users/family/site", "Our site");
const children = [
  { id: AVA, name: "Ava" },
  { id: LEO, name: "Leo" },
];

const titles = (projects: ReadonlyArray<OrchestrationProjectShell>, viewer: QuestionsViewer) =>
  (labelQuestionsSpaces(projects, ROOT, viewer) ?? projects).map((project) => project.title);

describe("what each Questions space is called", () => {
  it("on the family's Mac and grown-ups' devices: whose questions they are", () => {
    const mac = { childDevice: false, familyOn: true, children };
    expect(titles([SHARED, AVAS, LEOS, SITE], mac)).toEqual([
      "Earlier questions",
      "Ava's questions",
      "Leo's questions",
      "Our site",
    ]);
  });

  it("on a child's own device: Questions (the engine sends only their own)", () => {
    const own = { childDevice: true, familyOn: true, children };
    expect(titles([AVAS], own)).toEqual(["Questions"]);
    // With earlier questions of their own in the shared space, that one says so.
    expect(titles([SHARED, AVAS], own)).toEqual(["Earlier questions", "Questions"]);
  });

  it("follows a renamed child, and the profile off keeps T3's one space as Questions", () => {
    const renamed = { childDevice: false, familyOn: true, children: [{ id: AVA, name: "Avery" }] };
    expect(titles([AVAS], renamed)).toEqual(["Avery's questions"]);
    const off = { childDevice: false, familyOn: false, children: [] };
    expect(titles([SHARED, AVAS], off)).toEqual(["Questions", "Ava's questions"]);
  });

  it("leaves a list without spaces as it is", () => {
    expect(
      labelQuestionsSpaces([SITE], ROOT, { childDevice: false, familyOn: true, children }),
    ).toBe(null);
  });
});

describe("a child's own space is a Questions space everywhere", () => {
  const named = labelQuestionsSpaces([SHARED, AVAS, SITE], ROOT, {
    childDevice: true,
    familyOn: true,
    children,
  })!;
  // As the client runtime gives them to screens: the engine's project, scoped to its Mac.
  const scoped = named.map((project) => ({
    ...(project as unknown as { id: string; workspaceRoot: string; title: string }),
    environmentId: "mac",
    // T3 marks its own Scratch project; the label step marks a child's space.
    ...(project.id === "questions" ? { isScratch: true as const } : {}),
  }));
  const avas = scoped.find((project) => project.id === "ava-questions")!;

  it("is marked, so the compose box and the lists treat it as Questions, not a project", () => {
    expect(isQuestionsProject(avas)).toBe(true);
    expect(realProjects(scoped).map((project) => project.id)).toEqual(["site"]);
    expect(
      composeTargetFor({
        projects: scoped,
        questionsAvailable: true,
        chosen: null,
        preferredKey: "mac:ava-questions",
        last: null,
      }),
    ).toEqual({ kind: "question" });
  });

  it("offers Make this a project there, and its conversation follows the new project", () => {
    const folder = `${ROOT}/children/${AVA}/2026-10-24-make-a-volcano-page-1a2b3c4d`;
    expect(
      makeProjectOffer({
        ownProject: avas,
        adopted: false,
        worktreePath: folder,
        archived: false,
        working: false,
      }),
    ).toBe("offer");
    const volcano = {
      environmentId: "mac",
      id: "volcano",
      title: "Volcano",
      workspaceRoot: folder,
    };
    expect(projectForConversation({ worktreePath: folder }, avas, [...scoped, volcano])).toBe(
      volcano,
    );
  });
});
