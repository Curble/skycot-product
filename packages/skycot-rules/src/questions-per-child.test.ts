// Just ask, one space per child: which folder is whose space, who owns each, where a child may
// start a question, and what each screen calls a space.
import { describe, expect, it } from "vite-plus/test";

import { childSeesProject } from "./people.ts";
import {
  childMayStartQuestionIn,
  childQuestionsFolder,
  EARLIER_QUESTIONS_LABEL,
  isInQuestionsSpace,
  isQuestionsSpace,
  QUESTIONS_LABEL,
  questionsSpaceLabel,
  questionsSpaceOf,
  questionsSpaceOwners,
  SHARED_QUESTIONS_OWNER,
  workRootsFor,
} from "./questions.ts";

const ROOT = "/Users/me/.skycot/scratch";
const AVA = "c0a0a0a0a0a";
const LEO = "c1e01e01e01";
const AVAS = `${ROOT}/children/${AVA}`;
const LEOS = `${ROOT}/children/${LEO}`;
const AVAS_QUESTION = `${AVAS}/2026-10-24-why-is-the-sky-blue-1a2b3c4d`;
const EARLIER = `${ROOT}/2026-10-23-make-a-pony-page-5e6f7a8b`;

describe("one Questions space per child", () => {
  it("a child's space sits in the children folder, named by the child's id", () => {
    expect(childQuestionsFolder(ROOT, AVA)).toBe(AVAS);
    expect(childQuestionsFolder(`${ROOT}/`, AVA)).toBe(AVAS);
    // Only an id the Family profile could have made: nothing that climbs or names a path.
    expect(childQuestionsFolder(ROOT, "../../Documents")).toBeNull();
    expect(childQuestionsFolder(ROOT, "")).toBeNull();
    expect(childQuestionsFolder(null, AVA)).toBeNull();
    expect(childQuestionsFolder("/", AVA)).toBeNull();
  });

  it("knows each space by its folder, and nothing else counts as one", () => {
    expect(questionsSpaceOf(ROOT, ROOT)).toEqual({ kind: "shared" });
    expect(questionsSpaceOf(AVAS, ROOT)).toEqual({ kind: "child", childId: AVA });
    expect(questionsSpaceOf(`${LEOS}/`, ROOT)).toEqual({ kind: "child", childId: LEO });
    expect(questionsSpaceOf(AVAS_QUESTION, ROOT)).toBeNull();
    expect(questionsSpaceOf(EARLIER, ROOT)).toBeNull();
    expect(questionsSpaceOf(`${ROOT}/children`, ROOT)).toBeNull();
    expect(questionsSpaceOf(`${ROOT}/children/not-a-child`, ROOT)).toBeNull();
    expect(questionsSpaceOf(`${AVAS}/../${LEO}`, ROOT)).toEqual({ kind: "child", childId: LEO });
    expect(questionsSpaceOf("/Users/me/children/" + AVA, ROOT)).toBeNull();
    expect(isQuestionsSpace(AVAS, ROOT)).toBe(true);
    expect(isQuestionsSpace(AVAS_QUESTION, ROOT)).toBe(false);
    // A child's space and everything in it is inside SKYCOT's Questions folder.
    expect(isInQuestionsSpace(AVAS, ROOT)).toBe(true);
    expect(isInQuestionsSpace(AVAS_QUESTION, ROOT)).toBe(true);
  });

  it("a question in a child's space still works in its own folder only", () => {
    expect(
      workRootsFor({ projectFolder: AVAS, worktreePath: AVAS_QUESTION, questionsRoot: ROOT }),
    ).toEqual({ projectRoot: AVAS_QUESTION, projectFolder: AVAS_QUESTION });
  });

  it("owners follow the folder: a child's space is theirs, the shared one the grown-ups'", () => {
    const owners = questionsSpaceOwners(
      [
        { projectId: "questions", workspaceRoot: ROOT },
        { projectId: "ava-questions", workspaceRoot: AVAS },
        { projectId: "leo-questions", workspaceRoot: LEOS },
        { projectId: "volcano", workspaceRoot: AVAS_QUESTION },
        { projectId: "site", workspaceRoot: "/Users/me/site" },
      ],
      ROOT,
    );
    expect(owners).toEqual({
      questions: SHARED_QUESTIONS_OWNER,
      "ava-questions": AVA,
      "leo-questions": LEO,
    });
    expect(questionsSpaceOwners([{ projectId: "q", workspaceRoot: ROOT }], null)).toEqual({});
  });

  it("the old bug: the shared space recorded as Ava's no longer shuts Leo out, nor lets Ava in Leo's", () => {
    // What a Mac that had the bug recorded: the shared space as whoever asked first.
    const recorded = { questions: AVA };
    const projects = {
      ...recorded,
      ...questionsSpaceOwners(
        [
          { projectId: "questions", workspaceRoot: ROOT },
          { projectId: "ava-questions", workspaceRoot: AVAS },
          { projectId: "leo-questions", workspaceRoot: LEOS },
        ],
        ROOT,
      ),
    };
    const owners = { threads: {}, projects };
    expect(childSeesProject(LEO, "leo-questions", owners)).toBe(true);
    expect(childSeesProject(AVA, "ava-questions", owners)).toBe(true);
    expect(childSeesProject(AVA, "leo-questions", owners)).toBe(false);
    expect(childSeesProject(LEO, "ava-questions", owners)).toBe(false);
    // The shared space is the grown-ups': listed for a child only with questions of their own.
    expect(childSeesProject(AVA, "questions", owners)).toBe(false);
    expect(childSeesProject(AVA, "questions", owners, new Set(["questions"]))).toBe(true);
  });

  it("a child starts new questions in their own space only", () => {
    expect(childMayStartQuestionIn(AVA, { kind: "child", childId: AVA })).toBe(true);
    expect(childMayStartQuestionIn(AVA, { kind: "child", childId: LEO })).toBe(false);
    expect(childMayStartQuestionIn(AVA, { kind: "shared" })).toBe(false);
  });
});

describe("what a space is called", () => {
  const names: Record<string, string> = { [AVA]: "Ava", [LEO]: "Leo" };
  const nameOf = (id: string) => names[id] ?? null;

  it("grown-ups and the family's Mac see whose it is", () => {
    const mac = { childDevice: false, familyOn: true, nameOf };
    expect(questionsSpaceLabel({ kind: "child", childId: AVA }, mac)).toBe("Ava's questions");
    expect(questionsSpaceLabel({ kind: "child", childId: LEO }, mac)).toBe("Leo's questions");
    expect(questionsSpaceLabel({ kind: "shared" }, mac)).toBe(EARLIER_QUESTIONS_LABEL);
  });

  it("a child's own device says Questions", () => {
    const own = { childDevice: true, familyOn: true, nameOf };
    expect(questionsSpaceLabel({ kind: "child", childId: AVA }, own)).toBe(QUESTIONS_LABEL);
    expect(questionsSpaceLabel({ kind: "shared" }, own)).toBe(EARLIER_QUESTIONS_LABEL);
  });

  it("with the profile off the shared space is plain Questions; a child it no longer knows keeps the engine's title", () => {
    const off = { childDevice: false, familyOn: false, nameOf: () => null };
    expect(questionsSpaceLabel({ kind: "shared" }, off)).toBe(QUESTIONS_LABEL);
    expect(
      questionsSpaceLabel({ kind: "child", childId: AVA }, { ...off, title: "Ava's questions" }),
    ).toBe("Ava's questions");
    expect(questionsSpaceLabel({ kind: "child", childId: AVA }, off)).toBe(QUESTIONS_LABEL);
  });
});
