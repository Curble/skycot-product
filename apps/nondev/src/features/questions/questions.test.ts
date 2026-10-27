import { describe, expect, it } from "vite-plus/test";

import {
  composeTargetFor,
  makeProjectOffer,
  projectForConversation,
  projectNameFrom,
  QUESTION_KEY,
  realProjects,
  suggestedProjectName,
} from "./questions";

const ENV = "env-1";
const project = (id: string, workspaceRoot: string, isScratch = false, createdAt = "") => ({
  environmentId: ENV,
  id,
  title: id,
  workspaceRoot,
  createdAt,
  ...(isScratch ? { isScratch: true as const } : {}),
});
const SPACE = "/Users/ava/.skycot/scratch";
const questions = project("questions", SPACE, true);
const games = project("games", "/Users/ava/games");
const site = project("site", "/Users/ava/site");

const target = (over: Partial<Parameters<typeof composeTargetFor>[0]>) =>
  composeTargetFor({
    projects: [questions, games, site],
    questionsAvailable: true,
    chosen: null,
    preferredKey: null,
    last: null,
    ...over,
  });

describe("where a new conversation goes", () => {
  it("starts in the newest project when several projects exist and nothing was chosen", () => {
    const older = project("older", "/Users/ava/older", false, "2026-01-01");
    const newest = project("newest", "/Users/ava/newest", false, "2026-02-01");
    expect(target({ projects: [questions, older, newest], defaultToNewest: true })).toEqual({
      kind: "project",
      project: newest,
    });
  });

  it("follows the person's pick in the box, then the sidebar, then the last one used", () => {
    expect(target({ chosen: QUESTION_KEY })).toEqual({ kind: "question" });
    expect(target({ chosen: `${ENV}:games`, preferredKey: `${ENV}:site` })).toEqual({
      kind: "project",
      project: games,
    });
    expect(target({ preferredKey: `${ENV}:site` })).toEqual({ kind: "project", project: site });
    expect(target({ last: { environmentId: ENV, projectId: "games" } })).toEqual({
      kind: "project",
      project: games,
    });
  });

  it("the Questions space, picked anywhere, means Just ask", () => {
    expect(target({ preferredKey: `${ENV}:questions` })).toEqual({ kind: "question" });
    expect(target({ last: { environmentId: ENV, projectId: "questions" } })).toEqual({
      kind: "question",
    });
  });

  it("with no projects yet, a new person can just ask", () => {
    expect(target({ projects: [] })).toEqual({ kind: "question" });
    expect(target({ projects: [questions] })).toEqual({ kind: "question" });
    expect(target({ projects: [questions, games] })).toEqual({ kind: "project", project: games });
  });

  it("never offers Just ask on a Mac without a Questions space", () => {
    const off = { questionsAvailable: false };
    expect(target({ ...off, projects: [] })).toBeNull();
    expect(target({ ...off, chosen: QUESTION_KEY })).toBeNull();
    expect(target({ ...off, projects: [games], chosen: QUESTION_KEY })).toEqual({
      kind: "project",
      project: games,
    });
    expect(target({ ...off, last: { environmentId: ENV, projectId: "questions" } })).toBeNull();
  });

  it("forgets a project that is gone", () => {
    expect(target({ chosen: `${ENV}:deleted`, projects: [questions, games] })).toEqual({
      kind: "project",
      project: games,
    });
  });

  it("lists only the person's own projects in the picker", () => {
    expect(realProjects([questions, games, site]).map((p) => p.id)).toEqual(["games", "site"]);
  });
});

describe("a question that became a project", () => {
  const folder = `${SPACE}/2026-10-23-volcano-page-1a2b3c4d`;
  const volcanoes = project("volcanoes", folder);

  it("is listed with that project from then on", () => {
    expect(
      projectForConversation({ worktreePath: folder }, questions, [questions, volcanoes]),
    ).toBe(volcanoes);
    expect(
      projectForConversation({ worktreePath: `${folder}/` }, questions, [questions, volcanoes]),
    ).toBe(volcanoes);
  });

  it("stays a question otherwise, and ordinary conversations keep their project", () => {
    expect(projectForConversation({ worktreePath: folder }, questions, [questions])).toBe(
      questions,
    );
    expect(projectForConversation({ worktreePath: null }, questions, [questions, volcanoes])).toBe(
      questions,
    );
    expect(
      projectForConversation({ worktreePath: folder }, games, [questions, games, volcanoes]),
    ).toBe(games);
  });
});

describe("Make this a project", () => {
  const base = {
    ownProject: questions,
    adopted: false,
    worktreePath: `${SPACE}/q`,
    archived: false,
    working: false,
  };

  it("is offered on a question with a folder of its own", () => {
    expect(makeProjectOffer(base)).toBe("offer");
    expect(makeProjectOffer({ ...base, working: true })).toBe("working");
  });

  it("is not offered on projects, made ones, put-away ones, or a question without a folder", () => {
    expect(makeProjectOffer({ ...base, ownProject: games })).toBeNull();
    expect(makeProjectOffer({ ...base, adopted: true })).toBeNull();
    expect(makeProjectOffer({ ...base, archived: true })).toBeNull();
    expect(makeProjectOffer({ ...base, worktreePath: null })).toBeNull();
  });

  it("names the project from the question", () => {
    expect(suggestedProjectName("Make a volcano page")).toBe("Volcano page");
    expect(suggestedProjectName("Can you build me a pony game?")).toBe("Pony game");
    expect(suggestedProjectName("Why is the sky blue?")).toBe("Why is the sky blue");
    expect(suggestedProjectName("???")).toBe("???");
    expect(projectNameFrom("   ")).toBeNull();
    expect(projectNameFrom("  Space\n  rockets ")).toBe("Space rockets");
    expect(projectNameFrom("x".repeat(80))).toHaveLength(60);
  });
});
