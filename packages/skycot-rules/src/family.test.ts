import { describe, expect, it } from "vite-plus/test";

import { describeFamilyMatches, evaluateFamilyRequest, familyCommandMatches } from "./family.ts";

const ROOT = "/Users/me/games/space";
const ids = (command: string) => familyCommandMatches(command).map((match) => match.rule.id);
const needsGrownUp = (command: string) =>
  evaluateFamilyRequest({ kind: "command", command }, { projectRoot: ROOT }).needsGrownUp;

describe("family rules — ordinary project work stays with the child", () => {
  it.each([
    "ls -la",
    "cat index.html",
    "npm run build",
    "pnpm test",
    "node game.js",
    "python3 game.py",
    "git status",
    "git add -A && git commit -m 'save'",
    "mkdir sprites",
    "echo hello > notes.txt",
  ])("%s", (command) => {
    expect(ids(command)).toEqual([]);
    expect(needsGrownUp(command)).toBe(false);
  });
});

describe("family rules — the internet and installs need a grown-up", () => {
  it.each([
    ["curl https://example.com", "uses-internet"],
    ["wget http://x.test/file.zip", "uses-internet"],
    ["git push origin my-branch", "uses-internet"],
    ["git clone https://github.com/a/b", "uses-internet"],
    ["git fetch", "uses-internet"],
    ["npm install left-pad", "installs-software"],
    ["pnpm add three", "installs-software"],
    ["yarn", "installs-software"],
    ["npx create-react-app game", "installs-software"],
    ["pnpm dlx cowsay hi", "installs-software"],
    ["pip install pygame", "installs-software"],
    ["python3 -m pip install pygame", "installs-software"],
    ["brew install sl", "installs-software"],
    ["cargo install ripgrep", "installs-software"],
    ["open https://youtube.com", "uses-internet"],
    ["sudo ls", "admin-rights"],
    ["bash -c 'cd x && npm i'", "installs-software"],
    ["echo $(curl -s https://x.test)", "uses-internet"],
  ])("%s → %s", (command, id) => {
    expect(ids(command)).toContain(id);
    expect(needsGrownUp(command)).toBe(true);
  });

  it("a web-search tool call needs a grown-up whatever its prompt says", () => {
    const result = evaluateFamilyRequest(
      { kind: "command", command: "Search for dinosaur facts", toolItemType: "web_search" },
      { projectRoot: ROOT },
    );
    expect(result.needsGrownUp).toBe(true);
    expect(result.family.map((match) => match.rule.id)).toEqual(["uses-internet"]);
  });

  it("anything a hard rule holds needs a grown-up too", () => {
    const deletes = evaluateFamilyRequest(
      { kind: "command", command: "rm -rf sprites" },
      { projectRoot: ROOT },
    );
    expect(deletes.needsGrownUp).toBe(true);
    expect(deletes.family).toEqual([]);
    const outside = evaluateFamilyRequest(
      {
        kind: "file-change",
        files: [{ path: "/Users/me/Documents/tax.pdf", operation: "change" }],
      },
      { projectRoot: ROOT },
    );
    expect(outside.needsGrownUp).toBe(true);
    expect(
      evaluateFamilyRequest(
        { kind: "file-change", files: [{ path: `${ROOT}/index.html`, operation: "change" }] },
        { projectRoot: ROOT },
      ).needsGrownUp,
    ).toBe(false);
    expect(evaluateFamilyRequest({ kind: "permission" }).needsGrownUp).toBe(true);
  });

  it("describes what it caught in a short phrase", () => {
    expect(describeFamilyMatches(familyCommandMatches("npm install x"))).toBe(
      "installs something and uses the internet",
    );
  });
});
