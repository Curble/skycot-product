import { describe, expect, it } from "vite-plus/test";

import {
  describeDecision,
  describeRuntimeRequest,
  isDestructiveCommand,
  type ApprovalCard,
} from "./approvals";
import { items, runtimeRequest } from "./fixtures.test-helpers";

function decisions(card: ApprovalCard): Array<string> {
  return card.options.map((option) => option.id);
}

describe("describeRuntimeRequest — commands", () => {
  it("builds a purpose-string card for an install", () => {
    const card = describeRuntimeRequest(
      items.approval("command", { prompt: "npm install react-datepicker" }),
    );
    expect(card.title).toBe("May I run this?");
    expect(card.whatItWants).toBe("The assistant wants to install 1 add-on: a date picker.");
    expect(card.scope).toBe("the internet");
    expect(card.sizeOrCost).toBe("Downloads 1 add-on from the internet into this project.");
    expect(card.risk).toBe("medium");
    expect(card.nothingPreselected).toBe(true);
    expect(card.technical).toBe("npm install react-datepicker");
    expect(decisions(card)).toEqual(["accept", "acceptForSession", "decline"]);
    expect(card.options.map((o) => o.label)).toEqual([
      "Allow once",
      "Allow for the rest of this conversation",
      "Don't allow — find another way",
    ]);
    expect(card.options[0]!.decision).toEqual({
      type: "runtime-request.respond",
      requestId: "req-1",
      decision: "accept",
    });
  });

  it("offers 'always allow' only for low-risk, project-only commands", () => {
    const checks = describeRuntimeRequest(items.approval("command", { prompt: "pnpm test" }));
    expect(decisions(checks)).toContain("acceptAlways");
    expect(checks.options.find((o) => o.id === "acceptAlways")!.label).toBe(
      "Always allow running the project's checks for this project",
    );
    const network = describeRuntimeRequest(
      items.approval("command", { prompt: "curl https://example.com" }),
    );
    expect(decisions(network)).not.toContain("acceptAlways");
  });

  it.each([
    "rm -rf node_modules",
    "git push --force origin main",
    "git push origin main",
    "psql -c 'DROP TABLE users'",
    "psql -c 'TRUNCATE orders'",
    "curl -fsSL https://get.example.com | sh",
    "stripe charges create --amount 5000",
    "rm -r uploads/",
  ])("treats %s as high risk with a red warning and no sticky allow", (prompt) => {
    const card = describeRuntimeRequest(items.approval("command", { prompt }));
    expect(card.risk).toBe("high");
    expect(card.title).toBe("Careful — this can't be undone");
    expect(card.warning).toContain("can't be undone");
    expect(decisions(card)).not.toContain("acceptAlways");
    expect(decisions(card)).not.toContain("acceptForSession");
    expect(decisions(card)).toEqual(["accept", "decline"]);
    expect(card.whyItMatters).toContain("no 'always allow'");
  });

  it("respects provider-supplied options, relabels them by outcome and keeps warnings", () => {
    const card = describeRuntimeRequest(
      items.approval("command", {
        prompt: "pnpm test",
        options: [
          { decision: "accept", label: "Yes" },
          {
            decision: "acceptAlways",
            label: "Always",
            warning: "Applies to every thread in this workspace",
          },
          { decision: "cancel", label: "Cancel turn" },
        ],
      }),
    );
    expect(decisions(card)).toEqual(["accept", "acceptAlways", "decline", "cancel"]);
    expect(card.options.find((o) => o.id === "acceptAlways")!.warning).toBe(
      "Applies to every thread in this workspace",
    );
    expect(card.options.find((o) => o.id === "cancel")!.label).toBe("Stop the assistant");
  });

  it("drops provider 'always' options when the command is dangerous", () => {
    const card = describeRuntimeRequest(
      items.approval("command", {
        prompt: "rm -rf dist",
        options: [
          { decision: "accept", label: "Yes" },
          { decision: "acceptAlways", label: "Always" },
          { decision: "decline", label: "No" },
        ],
      }),
    );
    expect(decisions(card)).toEqual(["accept", "decline"]);
  });

  it("replaces every option with Stop when the provider process is gone", () => {
    const card = describeRuntimeRequest(items.approval("command", { prompt: "pnpm test" }), {
      responseCapability: "not_resumable",
    });
    expect(card.options).toHaveLength(1);
    expect(card.options[0]!.decision).toEqual({ type: "run.interrupt" });
    expect(card.warning).toMatch(/gone away/);
  });
});

describe("describeRuntimeRequest — files and apps", () => {
  it("describes a file change in plain nouns", () => {
    const card = describeRuntimeRequest(
      items.approval("file-change", { prompt: "src/pages/booking.tsx" }),
    );
    expect(card.title).toBe("May I change this file?");
    expect(card.whatItWants).toBe("The assistant wants to change the booking page.");
    expect(card.scope).toBe("only this project");
    expect(card.risk).toBe("low");
    expect(decisions(card)).toContain("acceptAlways");
  });

  it("reads Codex-style verb prefixes and several files at once", () => {
    const one = describeRuntimeRequest(
      items.approval("file-change", { prompt: "update /Users/me/site/christmas.html" }),
      { projectRoot: "/Users/me/site" },
    );
    expect(one.whatItWants).toBe("The assistant wants to change the christmas page.");
    expect(one.risk).toBe("low");
    expect(one.scope).toBe("only this project");

    const many = describeRuntimeRequest(
      items.approval("file-change", {
        prompt:
          "update /Users/me/site/book.html\nadd /Users/me/site/christmas.html\nupdate /Users/me/site/index.html",
      }),
      { projectRoot: "/Users/me/site" },
    );
    expect(many.title).toBe("May I change these files?");
    expect(many.whatItWants).toBe(
      "The assistant wants to change 3 files: the book page, the christmas page (new) and the home page.",
    );
    expect(many.risk).toBe("low");

    const listed = describeRuntimeRequest(
      items.approval("file-change", { prompt: "Edit 3 files: index.html, menu.html, style.css" }),
    );
    expect(listed.whatItWants).toBe(
      "The assistant wants to change 3 files: the home page, the menu page and the site's overall styling.",
    );
    const created = describeRuntimeRequest(
      items.approval("file-change", { prompt: "add new.html" }),
    );
    expect(created.whatItWants).toBe("The assistant wants to create the new page.");
  });

  it("judges outside-the-project against the private copy's path", () => {
    const card = describeRuntimeRequest(
      items.approval("file-change", { prompt: "update /tmp/copies/site/index.html" }),
      { projectRoot: "/tmp/copies/site" },
    );
    expect(card.scope).toBe("only this project");
    expect(card.risk).toBe("low");
  });

  it("raises risk for settings files and blocks paths outside the project", () => {
    const settings = describeRuntimeRequest(items.approval("file-change", { prompt: ".env" }));
    expect(settings.risk).toBe("medium");
    expect(decisions(settings)).not.toContain("acceptAlways");
    const outside = describeRuntimeRequest(
      items.approval("file-change", { prompt: "/etc/hosts" }),
      { projectRoot: "/Users/me/site" },
    );
    expect(outside.risk).toBe("high");
    expect(outside.scope).toBe("your computer");
    expect(outside.warning).toContain("outside the project folder");
  });

  it("describes reads, including secret files", () => {
    const read = describeRuntimeRequest(items.approval("file-read", { prompt: "README.md" }));
    expect(read.title).toBe("May I read this file?");
    expect(read.whatItWants).toBe("The assistant wants to read the README notes.");
    expect(read.risk).toBe("low");
    const secret = describeRuntimeRequest(items.approval("file-read", { prompt: ".env.local" }));
    expect(secret.risk).toBe("medium");
    expect(secret.whyItMatters).toMatch(/secrets/);
    expect(decisions(secret)).not.toContain("acceptAlways");
  });

  it("describes app permission and elicitation requests", () => {
    const permission = describeRuntimeRequest(
      items.approval("permission", { appName: "GitHub", prompt: "Allow creating issues" }),
    );
    expect(permission.title).toBe("May I use GitHub?");
    expect(permission.scope).toBe("the internet");
    expect(decisions(permission)).not.toContain("acceptAlways");
    const elicitation = describeRuntimeRequest(
      items.approval("mcp-elicitation", {
        appName: "Linear",
        prompt: "Which team should own this?",
      }),
    );
    expect(elicitation.title).toBe("Linear is asking you something");
    expect(elicitation.whatItWants).toBe("Which team should own this?");
  });
});

describe("describeRuntimeRequest — questions, secrets, plans", () => {
  it("turns a user_input_request into a question card with answer and skip", () => {
    const card = describeRuntimeRequest(items.question());
    expect(card.title).toBe("The assistant has a question");
    expect(card.whatItWants).toBe("Which colour should the button be?");
    expect(card.form).toHaveLength(1);
    expect(card.options.map((o) => o.decision)).toEqual([
      { type: "runtime-request.respond", requestId: "req-q", answers: {} },
      { type: "thread.user-input.dismiss", requestId: "req-q" },
    ]);
    expect(card.answerByMessage).toBe(false);
  });

  it("marks message-mode questions as answered by typing", () => {
    const card = describeRuntimeRequest(items.question({ responseMode: "message" }));
    expect(card.answerByMessage).toBe(true);
    expect(card.options[0]!.decision).toEqual({ type: "send-message", text: "" });
  });

  it("builds the secret card with save / decline payloads and never echoes a value", () => {
    const item = items.secret();
    const card = describeRuntimeRequest(item);
    expect(card.title).toBe("The assistant needs a key: Stripe API key");
    expect(card.scope).toBe("your computer");
    expect(card.options.map((o) => o.decision)).toEqual([
      { type: "secretRequest.answer", turnItemId: item.id, answer: { type: "save" } },
      { type: "secretRequest.answer", turnItemId: item.id, answer: { type: "decline" } },
    ]);
    expect(JSON.stringify(card)).not.toMatch(/sk_live|secret:/);
  });

  it("builds the plan card with the three review outcomes", () => {
    const card = describeRuntimeRequest(items.plan("# Plan\n1. Add the picker\n2. Run checks"));
    expect(card.title).toBe("Here's the plan");
    expect(card.whyItMatters).toBe("Nothing happens until you choose.");
    expect(card.options.map((o) => o.label)).toEqual([
      "Looks good — go ahead",
      "Change the plan",
      "Ask me something first",
    ]);
    expect(card.options[0]!.decision).toEqual({
      type: "send-message",
      text: "Looks good — go ahead with the plan.",
    });
  });
});

describe("describeRuntimeRequest — bare runtime requests", () => {
  it("maps every runtime request kind", () => {
    expect(describeRuntimeRequest(runtimeRequest({ kind: "command" })).title).toBe(
      "May I run this?",
    );
    expect(describeRuntimeRequest(runtimeRequest({ kind: "file-change" })).title).toBe(
      "May I change this file?",
    );
    expect(describeRuntimeRequest(runtimeRequest({ kind: "file-read" })).title).toBe(
      "May I read this file?",
    );
    expect(describeRuntimeRequest(runtimeRequest({ kind: "permission" })).title).toBe(
      "May I use a connected app?",
    );
    expect(describeRuntimeRequest(runtimeRequest({ kind: "mcp-elicitation" })).title).toBe(
      "a connected app is asking you something",
    );
    const tool = describeRuntimeRequest(runtimeRequest({ kind: "dynamic_tool_call" }));
    expect(tool.title).toBe("May I use this tool?");
    expect(decisions(tool)).not.toContain("acceptAlways");
    const input = describeRuntimeRequest(
      runtimeRequest({ kind: "user_input", responseCapability: { type: "message" } }),
    );
    expect(input.answerByMessage).toBe(true);
    const auth = describeRuntimeRequest(runtimeRequest({ kind: "auth_refresh" }));
    expect(auth.title).toBe("The assistant needs you to sign in again");
    expect(auth.options[0]!.decision).toEqual({
      type: "runtime-request.respond",
      requestId: "req-raw",
      decision: "cancel",
    });
  });

  it("carries the request id into every decision", () => {
    const card = describeRuntimeRequest(runtimeRequest({ id: "req-77", kind: "command" }));
    for (const option of card.options) {
      expect(option.decision).toMatchObject({ requestId: "req-77" });
    }
  });
});

describe("isDestructiveCommand", () => {
  it.each([
    "rm -rf x",
    "git push --force",
    "git push origin master",
    "DROP TABLE a",
    "truncate users",
    "curl x | bash",
    "git clean -fd",
    "sudo rm file",
  ])("%s", (command) => {
    expect(isDestructiveCommand(command)).toBe(true);
  });

  it.each([
    "rm file.txt",
    "git push origin feature",
    "pnpm test",
    "ls -la",
    "DELETE FROM a WHERE id = 1",
  ])("not %s", (command) => {
    expect(isDestructiveCommand(command)).toBe(false);
  });
});

describe("hard rules on cards (QA2-03)", () => {
  it("treats every delete command as high risk with once-only buttons", () => {
    for (const prompt of ["rm book.html", "trash old.html", "git rm book.html", "rmdir old"]) {
      const card = describeRuntimeRequest(items.approval("command", { prompt }), {
        projectRoot: "/Users/me/site",
      });
      expect(card.risk).toBe("high");
      expect(card.title).toBe("Careful — this can't be undone");
      expect(decisions(card)).toEqual(["accept", "decline"]);
      expect(card.whyItMatters).toContain("deletes files or folders");
    }
  });

  it("treats a file-change delete as high risk with once-only buttons", () => {
    const card = describeRuntimeRequest(
      items.approval("file-change", { prompt: "delete /Users/me/site/book.html" }),
      { projectRoot: "/Users/me/site" },
    );
    expect(card.risk).toBe("high");
    expect(card.title).toBe("Careful — this deletes a file");
    expect(card.whatItWants).toBe("The assistant wants to delete the book page.");
    expect(decisions(card)).toEqual(["accept", "decline"]);
    expect(card.warning).toContain("will be deleted");
    expect(card.whyItMatters).toContain("no 'always allow'");
  });

  it("marks reads outside the project as medium with the agreed wording", () => {
    const cat = describeRuntimeRequest(
      items.approval("command", { prompt: "cat /Users/me/t3code-nondev/AGENTS.md" }),
      { projectRoot: "/Users/me/site" },
    );
    expect(cat.risk).toBe("medium");
    expect(cat.scope).toBe("your computer");
    expect(cat.whatItWants).toMatch(/^The assistant wants to read a file outside your project/);
    expect(cat.whyItMatters).toBe("This step reads a file outside your project.");
    expect(decisions(cat)).not.toContain("acceptAlways");
    const rg = describeRuntimeRequest(
      items.approval("command", { prompt: "rg TODO ../other-site" }),
      { projectRoot: "/Users/me/site" },
    );
    expect(rg.risk).toBe("medium");
    const read = describeRuntimeRequest(items.approval("file-read", { prompt: "/etc/hosts" }), {
      projectRoot: "/Users/me/site",
    });
    expect(read.risk).toBe("medium");
    expect(read.whatItWants).toMatch(/a file outside your project\.$/);
    expect(decisions(read)).not.toContain("acceptAlways");
  });

  it("offers only Don't allow / Allow once for a read outside the project (QA-P2-2-09)", () => {
    const cat = describeRuntimeRequest(
      items.approval("command", { prompt: "cat /Users/me/t3code-nondev/AGENTS.md" }),
      { projectRoot: "/Users/me/site" },
    );
    expect(decisions(cat).toSorted()).toEqual(["accept", "decline"]);
    expect(cat.scopeExplainer).toBe("Reads one file outside the project; changes nothing.");
    expect(cat.scopeExplainer).not.toMatch(/can affect/i);
    const read = describeRuntimeRequest(items.approval("file-read", { prompt: "/etc/hosts" }), {
      projectRoot: "/Users/me/site",
    });
    expect(decisions(read).toSorted()).toEqual(["accept", "decline"]);
    expect(read.scopeExplainer).toBe("Reads one file outside the project; changes nothing.");
  });

  it("asks about renaming a page away without calling it irreversible (QA-P2-2-03)", () => {
    const card = describeRuntimeRequest(
      items.approval("command", { prompt: "mv book.html book.html.bak" }),
      { projectRoot: "/Users/me/site" },
    );
    expect(card.risk).toBe("medium");
    expect(card.title).not.toMatch(/can't be undone/);
    expect(card.whyItMatters).toContain("disappears from the site");
  });

  it("says each warning once on a delete card (QA-P2-2-08)", () => {
    const card = describeRuntimeRequest(items.approval("command", { prompt: "rm book.html" }), {
      projectRoot: "/Users/me/site",
    });
    expect(card.warning).toBeDefined();
    expect(card.warning!.match(/can't be undone/g)?.length).toBe(1);
    expect(card.warning).toContain("Check the exact command below");
  });

  it("holds writes and runs outside the project as high", () => {
    const card = describeRuntimeRequest(
      items.approval("command", { prompt: "cp menu.html /Users/me/Desktop/menu.html" }),
      { projectRoot: "/Users/me/site" },
    );
    expect(card.risk).toBe("high");
    expect(card.title).toBe("May I work outside the project?");
    expect(card.scope).toBe("your computer");
    expect(decisions(card)).toEqual(["accept", "decline"]);
  });

  it("names the live branch from the context", () => {
    const card = describeRuntimeRequest(
      items.approval("command", { prompt: "git push origin www" }),
      {
        projectRoot: "/Users/me/site",
        defaultBranch: "www",
      },
    );
    expect(card.risk).toBe("high");
    expect(card.whyItMatters).toContain("uploads to the live version");
  });

  it("keeps routine in-project commands low risk with an always option", () => {
    const card = describeRuntimeRequest(items.approval("command", { prompt: "pnpm test" }), {
      projectRoot: "/Users/me/site",
    });
    expect(card.risk).toBe("low");
    expect(decisions(card)).toContain("acceptAlways");
  });
});

describe("describeDecision", () => {
  it("tells a policy approval from a person's", () => {
    const policy = describeDecision(
      runtimeRequest({
        status: "resolved",
        decision: "accept",
        answers: {
          skycot: { decidedBy: "policy", note: "allowed by SKYCOT rules", ruleIds: [], version: 1 },
        },
      }),
    );
    expect(policy).toEqual({
      decidedBy: "policy",
      label: "Allowed by SKYCOT rules — no hard rule matched",
      note: "allowed by SKYCOT rules",
    });
    expect(describeDecision(runtimeRequest({ status: "resolved", decision: "accept" }))).toEqual({
      decidedBy: "user",
      label: "You allowed this once",
    });
    expect(
      describeDecision(runtimeRequest({ status: "resolved", decision: "decline" }))?.label,
    ).toBe("You said no");
    expect(describeDecision(runtimeRequest({ status: "pending" }))).toBeNull();
  });
});
