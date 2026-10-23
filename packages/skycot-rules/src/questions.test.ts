import { describe, expect, it } from "vite-plus/test";

import { evaluateFamilyRequest } from "./family.ts";
import { isInQuestionsSpace, isQuestionsSpace, sameFolder, workRootsFor } from "./questions.ts";

const SPACE = "/Users/me/.skycot/scratch";
const MINE = `${SPACE}/2026-10-23-why-is-the-sky-blue-1a2b3c4d`;
const SISTERS = `${SPACE}/2026-10-23-make-a-volcano-page-5e6f7a8b`;

describe("the Questions space", () => {
  it("knows the space itself, however it is spelled", () => {
    expect(isQuestionsSpace(SPACE, SPACE)).toBe(true);
    expect(isQuestionsSpace(`${SPACE}/`, SPACE)).toBe(true);
    expect(isQuestionsSpace(`${SPACE}/x/..`, SPACE)).toBe(true);
    expect(isQuestionsSpace("/Users/me/Documents", SPACE)).toBe(false);
    expect(isQuestionsSpace(SPACE, null)).toBe(false);
    expect(sameFolder(null, SPACE)).toBe(false);
  });

  it("a question's own folder is inside; the space itself and climbing out are not", () => {
    expect(isInQuestionsSpace(MINE, SPACE)).toBe(true);
    expect(isInQuestionsSpace(`${MINE}/index.html`, SPACE)).toBe(true);
    expect(isInQuestionsSpace(SPACE, SPACE)).toBe(false);
    expect(isInQuestionsSpace(`${SPACE}/../Documents`, SPACE)).toBe(false);
    expect(isInQuestionsSpace(`${SPACE}-other/x`, SPACE)).toBe(false);
    expect(isInQuestionsSpace("relative/folder", SPACE)).toBe(false);
    expect(isInQuestionsSpace(MINE, null)).toBe(false);
    expect(isInQuestionsSpace("/x", "/")).toBe(false);
  });
});

describe("where a question may work", () => {
  const roots = workRootsFor({ projectFolder: SPACE, worktreePath: MINE, questionsRoot: SPACE });

  it("is its own folder only", () => {
    expect(roots).toEqual({ projectRoot: MINE, projectFolder: MINE });
  });

  it("an ordinary conversation keeps its private copy and its project", () => {
    expect(
      workRootsFor({
        projectFolder: "/Users/me/site",
        worktreePath: "/Users/me/.skycot/worktrees/site/a",
        questionsRoot: SPACE,
      }),
    ).toEqual({
      projectRoot: "/Users/me/.skycot/worktrees/site/a",
      projectFolder: "/Users/me/site",
    });
    expect(
      workRootsFor({ projectFolder: "/Users/me/site", worktreePath: null, questionsRoot: null }),
    ).toEqual({ projectRoot: "/Users/me/site", projectFolder: "/Users/me/site" });
  });

  it("a question without a folder of its own works in the space", () => {
    expect(
      workRootsFor({ projectFolder: SPACE, worktreePath: null, questionsRoot: SPACE }),
    ).toEqual({ projectRoot: SPACE, projectFolder: SPACE });
  });

  it("Family rules: the child's own question folder is open", () => {
    const own = evaluateFamilyRequest(
      { kind: "file-change", files: [{ path: `${MINE}/index.html`, operation: "add" }] },
      roots,
    );
    expect(own.needsGrownUp).toBe(false);
    expect(
      evaluateFamilyRequest({ kind: "command", command: "node volcano.js" }, roots).needsGrownUp,
    ).toBe(false);
  });

  it("Family rules: a sibling's question is outside, and so are the person's real folders", () => {
    const sibling = evaluateFamilyRequest(
      { kind: "file-change", files: [{ path: `${SISTERS}/index.html`, operation: "change" }] },
      roots,
    );
    expect(sibling.needsGrownUp).toBe(true);
    expect(sibling.base.matches.map((match) => match.rule.id)).toContain("outside-project");
    const documents = evaluateFamilyRequest(
      {
        kind: "file-read",
        files: [{ path: "/Users/me/Documents/diary.txt", operation: "change" }],
      },
      roots,
    );
    expect(documents.needsGrownUp).toBe(true);
  });

  it("Family rules: installs and the internet still need the code inside a question", () => {
    for (const command of ["npm install three", "curl https://example.com"]) {
      expect(evaluateFamilyRequest({ kind: "command", command }, roots).needsGrownUp).toBe(true);
    }
  });
});
