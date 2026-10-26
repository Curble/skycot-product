import { describe, expect, it } from "vite-plus/test";

import type { VcsStatusResult } from "@t3tools/contracts";

import {
  branchNameFor,
  folderReadiness,
  plainPrivateCopyProblem,
  shouldAskTrackingSheet,
  STARTER_GITIGNORE,
} from "./privateCopy";

const status = (over: Partial<VcsStatusResult>): VcsStatusResult =>
  ({
    isRepo: true,
    hasPrimaryRemote: false,
    isDefaultRef: true,
    refName: "main",
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    ...over,
  }) as VcsStatusResult;

describe("branchNameFor", () => {
  it("turns the request into a short Git-safe branch under skycot/", () => {
    expect(
      branchNameFor(
        "Add a 'Christmas menu' page with three placeholder dishes, link it from the nav",
        "3fa2b1c9",
      ),
    ).toBe("skycot/christmas-menu-page-three-placeholder-3fa2");
  });

  it("falls back when the request has no usable words", () => {
    expect(branchNameFor("!!! ???", "ABCDEF")).toBe("skycot/conversation-abcd");
    expect(branchNameFor("", "")).toBe("skycot/conversation-0000");
  });

  it("uses only the first line and never produces Git-illegal characters", () => {
    const branch = branchNameFor("Fix the “Book a table” button\nand more detail here", "9z");
    expect(branch).toBe("skycot/fix-book-table-button-9z");
    expect(branch).toMatch(/^skycot\/[a-z0-9-]+$/);
  });
});

describe("folderReadiness", () => {
  it("asks for init when the folder is not a repository", () => {
    expect(folderReadiness(status({ isRepo: false }))).toEqual({ kind: "needs-init" });
  });
  it("needs a named branch to copy from", () => {
    expect(folderReadiness(status({ refName: null }))).toEqual({ kind: "no-branch" });
    expect(folderReadiness(status({ refName: "develop" }))).toEqual({
      kind: "ready",
      baseBranch: "develop",
    });
  });
  it("keeps the prompt for unknown folders and skips it for SKYCOT-created folders", () => {
    const needsInit = folderReadiness(status({ isRepo: false }));
    expect(shouldAskTrackingSheet(needsInit, false)).toBe(true);
    expect(shouldAskTrackingSheet(needsInit, true)).toBe(false);
    expect(shouldAskTrackingSheet({ kind: "ready", baseBranch: "main" }, false)).toBe(false);
  });
  it("omits common secret files from the first saved version by default", () => {
    expect(STARTER_GITIGNORE.split("\n")).toEqual(
      expect.arrayContaining([".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx"]),
    );
  });
});

describe("plainPrivateCopyProblem", () => {
  it("explains a missing Git identity in plain words", () => {
    expect(
      plainPrivateCopyProblem(new Error("Author identity unknown *** Please tell me who you are.")),
    ).toMatch(/name and email/);
  });
  it("explains an empty repository and keeps a calm default", () => {
    expect(plainPrivateCopyProblem(new Error("fatal: invalid reference: main"))).toMatch(
      /no saved version/,
    );
    expect(plainPrivateCopyProblem("boom")).toBe(
      "SKYCOT couldn't make a private copy of the project.",
    );
  });
});
