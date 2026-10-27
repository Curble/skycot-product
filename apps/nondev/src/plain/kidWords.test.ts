import { describe, expect, it } from "vite-plus/test";

import { items } from "./fixtures.test-helpers";
import { kidNouns, kidStep, kidTestOutcome } from "./kidWords";
import { describeTurnItem, progressHint, summarizeRun, type NarrationContext } from "./narration";

const kid: NarrationContext = { kid: true, kidThing: "game" };
const say = (command: string, extra: Record<string, unknown> = {}, ctx: NarrationContext = kid) =>
  describeTurnItem(items.command(command, extra), ctx).headline;

describe("kid words in progress lines", () => {
  it.each([
    ["cat AGENTS.md", "Read the instructions"],
    ["node -e \"console.log('hi')\"", "Tested your game"],
    ["node check.js", "Tested your game"],
    ["python3 -c 'print(1)'", "Tested your game"],
    ["npm test", "Tested your game"],
    ["npm install", "Got a tool ready"],
    ["npm install zod", "Got a tool ready"],
    ["npm run", "Got a tool ready"],
    ["npx eslint .", "Checked it looks right"],
    ["sqlite3 data.db 'select 1'", "Saved some information"],
  ])("says %s as %s", (command, headline) => {
    expect(say(command)).toBe(headline);
  });

  it("keeps grown-up words for everyone else", () => {
    expect(say("cat AGENTS.md", {}, {})).toBe("Looked at the agents text");
    expect(say("node -e '1'", {}, {})).toBe("Ran a short node program");
    expect(say("npm install", {}, {})).toBe("Set up the add-ons the project already lists");
    expect(say("npx eslint .", {}, {})).toBe("Ran a style check (passed)");
    expect(say("sqlite3 data.db 'select 1'", {}, {})).toBe("Worked with the database");
  });

  it("says 'Testing your page' when the child is not making a game", () => {
    expect(say("node -e '1'", {}, { kid: true, kidThing: "page" })).toBe("Tested your page");
    expect(say("node -e '1'", {}, { kid: true })).toBe("Tested your page");
  });

  it("follows the step through running, waiting and failing", () => {
    expect(say("node -e '1'", { status: "running" })).toBe("Testing your game");
    expect(say("node -e '1'", {}, kid)).toBe("Tested your game");
    const pending = describeTurnItem(items.command("npm install zod", { status: "pending" }), kid);
    expect(pending.headline).toBe("About to get a tool ready");
    const failed = describeTurnItem(items.command("npm install zod", { status: "failed" }), kid);
    expect(failed.headline).toBe("Tried to get a tool ready — it didn't work");
  });

  it("tells a child about a check that found something plainly, with no pass or fail codes", () => {
    expect(say("npm test", { exitCode: 1 })).toBe("Tested your game — found something to fix");
    expect(say("npm test", { exitCode: 0 })).not.toMatch(/passed|problems/);
    expect(kidTestOutcome("Tested your game", "failed", {})).toBe(
      "Tested your game — it didn't finish",
    );
  });

  it("changes the words only: the kind, status and technical text stay", () => {
    const item = items.command("node -e '1'");
    const plain = describeTurnItem(item, {});
    const child = describeTurnItem(item, kid);
    expect(child.kind).toBe(plain.kind);
    expect(child.status).toBe(plain.status);
    expect(child.technical).toBe(plain.technical);
    expect(child.risk).toBe(plain.risk);
  });

  it("names the instructions file the same way when the assistant reads it directly", () => {
    expect(kidNouns("Read the agents text")).toBe("Read the instructions");
    expect(kidNouns("Edited the booking page")).toBe("Edited the booking page");
    expect(kidNouns('Read "the agents text" and edit agents-text.md')).toBe(
      'Read "the agents text" and edit agents-text.md',
    );
  });

  it("keeps names intact and gives a new HTML page a plain checklist line", () => {
    expect(kidStep({ infinitive: "create index.html", kind: "file" }, "page")?.past).toBe(
      "Made the page",
    );
    for (const infinitive of [
      'add a heading called "Welcome, Ava"',
      'change the title to "My Space Lab"',
      "edit styles.css",
      "add a button named Start",
      "use the React library",
      "create README.md",
    ]) {
      expect(kidStep({ infinitive, kind: "command" }, "page")).toBeNull();
    }
  });

  it("folds several steps in one command into 'a few things'", () => {
    expect(say("npm install zod && node check.js")).toBe("Did a few things");
  });

  it("reaches the checklist and the live hint", () => {
    const work = [
      items.command("cat AGENTS.md"),
      items.command("npm install zod"),
      items.command("node -e '1'"),
    ];
    expect(summarizeRun(work, kid).checklist.done).toEqual([
      "Read the instructions",
      "Got a tool ready",
      "Tested your game",
    ]);
    expect(
      progressHint([items.command("node -e '1'", { status: "running" })], "running", kid),
    ).toBe("Testing your game…");
    expect(summarizeRun(work, {}).checklist.done).toContain("Looked at the agents text");
  });

  it("leaves steps it has no kid words for as they are", () => {
    expect(kidStep({ infinitive: "start the live preview", kind: "command" }, "game")).toBeNull();
    expect(say("git status")).toBe("Checked which files have changed");
  });
});
