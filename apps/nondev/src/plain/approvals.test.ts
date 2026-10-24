import { describe, expect, it } from "vite-plus/test";

import {
  approvalNeedsBranch,
  childApprovalOptions,
  childApprovalSentence,
  describeDecision,
  describeRuntimeRequest,
  isDestructiveCommand,
  REAL_PROJECT_TITLE,
  REAL_PROJECT_WARNING,
  toolCallInputFor,
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

  // QA FK-04: `cat > index.html <<EOF` replaced the home page but the card said it only read.
  it.each([
    ["cat > index.html <<'EOF'\n<h1>Axolotl!</h1>\nEOF", "write the home page"],
    ["cat <<'EOF' > index.html\n<h1>Axolotl!</h1>\nEOF", "write the home page"],
    ["cat >> notes.txt <<EOF\nmore\nEOF", "add to"],
    ["printf '<p>hi</p>' > index.html", "write the home page"],
    ["echo 'body { color: pink }' > style.css", "write"],
    ["echo hi >| index.html", "write the home page"],
    ["tee index.html < draft.html", "write the home page"],
    ["sed -i '' 's/blue/pink/' index.html", "change the home page"],
  ])("calls %s a change, never a read", (prompt, wants) => {
    const card = describeRuntimeRequest(items.approval("command", { prompt }));
    expect(card.whatItWants).toContain(wants);
    expect(card.whatItWants).not.toMatch(/look at/);
    expect(card.whyItMatters).not.toMatch(/only reads/);
    expect(card.whyItMatters).not.toMatch(/can't change anything/);
  });

  it("still calls a plain read a read", () => {
    const card = describeRuntimeRequest(items.approval("command", { prompt: "cat index.html" }));
    expect(card.whyItMatters).toBe("This only reads files. It can't change anything.");
    const quiet = describeRuntimeRequest(
      items.approval("command", { prompt: "cat index.html > /dev/null" }),
    );
    expect(quiet.whyItMatters).toBe("This only reads files. It can't change anything.");
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

describe("childApprovalSentence", () => {
  it("turns a held add-on ask into one short child-facing sentence", () => {
    const card = describeRuntimeRequest(items.approval("command", { prompt: "npm install three" }));
    expect(childApprovalSentence(card, "Sam")).toBe(
      "Sam wants to download a 3D tool. This one needs a grown-up.",
    );
  });
});

describe("childApprovalOptions", () => {
  it("keeps just Get a grown-up and No thanks", () => {
    const card = describeRuntimeRequest(items.approval("command", { prompt: "npm install three" }));
    expect(childApprovalOptions(card.options).map((option) => option.label)).toEqual([
      "Get a grown-up",
      "No thanks",
    ]);
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

  // Found recording screenshots: a private copy of "Little Fern Café website" was cut at the
  // first space, so an edit inside it read "create the little file" and "outside the project".
  it("treats the private copy (spaces and all) and the project folder as inside", () => {
    const copy =
      "/Users/kid/.skycot-family/worktrees/Little Fern Café website/skycot-christmas-menu-eedf";
    const ctx = { projectRoot: copy, projectFolder: "/Users/kid/Sites/Little Fern Café website" };
    const card = describeRuntimeRequest(
      items.approval("file-change", { prompt: `add ${copy}/christmas.html` }),
      ctx,
    );
    expect(card.whatItWants).toBe("The assistant wants to create the christmas page.");
    expect(card.scope).toBe("only this project");
    expect(card.risk).toBe("low");
    expect(card.warning).toBeUndefined();
    const folder = describeRuntimeRequest(
      items.approval("file-change", {
        prompt: "update /Users/kid/Sites/Little Fern Café website/menu.html",
      }),
      ctx,
    );
    expect(folder.scope).toBe("only this project");
    expect(folder.title).toBe(REAL_PROJECT_TITLE);
    const elsewhere = describeRuntimeRequest(
      items.approval("file-change", { prompt: "update /Users/kid/Documents/diary.txt" }),
      ctx,
    );
    expect(elsewhere.scope).toBe("your computer");
    expect(elsewhere.warning).toContain("outside the project folder");
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

  it("says what SKYCOT's own page tools do, never the engine's internal server name", () => {
    const ask = (tool: string, assistantName?: string) =>
      describeRuntimeRequest(
        items.approval("mcp-elicitation", {
          appName: "t3-code",
          prompt: `Allow the t3-code MCP server to run tool "${tool}"?`,
        }),
        assistantName === undefined ? {} : { assistantName },
      );
    const open = ask("preview_open", "Sam");
    expect(open.title).toBe("May I check your page?");
    expect(open.whatItWants).toBe("Sam wants to open your page to check it.");
    expect(open.whyItMatters).toContain(
      "The first time, SKYCOT downloads a small browser to look at pages (about 200 MB).",
    );
    expect(open.technical).toBe('Allow SKYCOT to run tool "preview_open"?');
    expect(ask("preview_snapshot", "Sam").whatItWants).toBe(
      "Sam wants to take a picture of your page.",
    );
    expect(ask("preview_press").whatItWants).toBe(
      "The assistant wants to try the buttons on your page.",
    );
    expect(ask("preview_evaluate").risk).toBe("medium");
    const helper = ask("delegate_task");
    expect(helper.title).toBe("May I use one of SKYCOT's tools?");
    expect(helper.whyItMatters).not.toMatch(/browser/);
    for (const card of [open, helper, ask("preview_resize"), ask("device_open")]) {
      const words = [
        card.title,
        card.whatItWants,
        card.whyItMatters,
        card.scopeExplainer,
        card.technical,
      ]
        .concat(card.options.map((option) => option.label))
        .join(" ");
      expect(words).not.toMatch(/t3-code|MCP server/i);
    }
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
      "Build it",
      "Change the plan",
      "Ask me something first",
    ]);
    expect(card.options[0]!.decision).toEqual({
      type: "send-message",
      text: "Build it: go ahead with the plan.",
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

describe("leaving the sandbox (N-2) and naming the rule (N-5)", () => {
  const PUSH = "/bin/zsh -lc 'git push --set-upstream origin skycot/upload-52d1'";
  const REASON =
    "Allow Git to push this branch to the local remote outside the workspace and set its upstream?";
  const codexRef = { driver: "codex", nativeId: "exec-1", strength: "strong" };
  const ask = (prompt: string) =>
    items.approval("command", { prompt }, { nativeItemRef: codexRef });

  it("asks before a Codex step leaves its safe area, once at a time", () => {
    const card = describeRuntimeRequest(ask(REASON), {
      projectRoot: "/Users/me/site",
      toolCallInput: PUSH,
    });
    expect(card.title).toBe("May I step outside the safe area?");
    expect(card.whatItWants).toBe(
      "The assistant normally works inside a walled-off area of your Mac. This step needs to reach outside it. It wants to upload the saved versions to the online copy.",
    );
    expect(card.risk).toBe("medium");
    expect(card.scope).toBe("your computer");
    expect(card.ruleTitle).toBe("Stepping outside the assistant's safe area");
    expect(decisions(card)).toEqual(["accept", "decline"]);
    expect(card.technical).toContain(PUSH);
    expect(card.technical).toContain(REASON);
  });

  it("is high, with the other rule named, when the step is risky anyway", () => {
    const card = describeRuntimeRequest(ask(REASON), {
      projectRoot: "/Users/me/site",
      toolCallInput: "/bin/zsh -lc 'npx vercel --prod'",
    });
    expect(card.title).toBe("May I step outside the safe area?");
    expect(card.risk).toBe("high");
    expect(card.whyItMatters).toContain("puts something live");
    expect(card.ruleTitle).toBe(
      "Stepping outside the assistant's safe area · Putting anything live or publishing a package",
    );
    expect(decisions(card)).toEqual(["accept", "decline"]);
  });

  it("an ordinary Codex ask (prompt is the command) is not a sandbox card", () => {
    const card = describeRuntimeRequest(ask(PUSH), { toolCallInput: PUSH });
    expect(card.title).toBe("May I run this?");
    expect(card.ruleTitle).toBeUndefined();
  });

  it("names the hard rule that held a deploy", () => {
    const card = describeRuntimeRequest(items.approval("command", { prompt: "npx vercel --prod" }));
    expect(card.title).toBe("Careful — this can't be undone");
    expect(card.ruleTitle).toBe("Putting anything live or publishing a package");
  });

  it("finds the command an ask is about by its native item", () => {
    const command = items.command(PUSH, {}, { nativeItemRef: codexRef });
    const other = items.command("ls", {}, { nativeItemRef: { ...codexRef, nativeId: "exec-2" } });
    expect(toolCallInputFor(ask(REASON), [other, command])).toBe(PUSH);
    expect(toolCallInputFor(items.approval("command"), [command])).toBeUndefined();
  });
});

describe("a push is judged with the branch the server judged it with (S-1)", () => {
  // Check A, 2026-10-22: the escalated retry of a sandboxed push from a private copy.
  const PUSH = "/bin/zsh -lc 'git push --set-upstream origin HEAD'";
  const REASON = "May I push this branch to the local origin repository outside the workspace?";
  const ROOT = "/Users/me/.t3/worktrees/foreman-demo-cafe/skycot-upload-this-branch-git-push-4849";
  const codexRef = { driver: "codex", nativeId: "call_push", strength: "strong" };
  const escalation = () =>
    items.approval("command", { prompt: REASON }, { nativeItemRef: codexRef });

  it("a skycot/* push that leaves the sandbox is orange with only the sandbox reason", () => {
    const card = describeRuntimeRequest(escalation(), {
      projectRoot: ROOT,
      toolCallInput: PUSH,
      currentBranch: "skycot/upload-this-branch-git-push-4849",
      defaultBranch: "main",
    });
    expect(card.title).toBe("May I step outside the safe area?");
    expect(card.risk).toBe("medium");
    expect(card.ruleTitle).toBe("Stepping outside the assistant's safe area");
    expect(card.whyItMatters).not.toMatch(/live version|can't tell which branch/);
    expect(card.warning).toBeUndefined();
    expect(decisions(card)).toEqual(["accept", "decline"]);
  });

  it("the same push from main is red and names the live version", () => {
    const card = describeRuntimeRequest(escalation(), {
      projectRoot: ROOT,
      toolCallInput: PUSH,
      currentBranch: "main",
      defaultBranch: "main",
    });
    expect(card.risk).toBe("high");
    expect(card.ruleTitle).toBe(
      "Stepping outside the assistant's safe area · Uploading straight to the live version",
    );
    expect(card.whyItMatters).toContain("uploads to the live version");
  });

  it("a bare push whose branch nobody knows is a medium question that says so", () => {
    const card = describeRuntimeRequest(items.approval("command", { prompt: "git push" }), {
      projectRoot: ROOT,
      currentBranch: null,
    });
    expect(card.risk).toBe("medium");
    expect(card.whyItMatters).toContain("SKYCOT can't tell which branch this uploads to");
    expect(card.warning).toBeUndefined();
  });

  it("only a push ask looks the branch up", () => {
    expect(approvalNeedsBranch(escalation(), PUSH)).toBe(true);
    expect(approvalNeedsBranch(items.approval("command", { prompt: "git push" }), undefined)).toBe(
      true,
    );
    expect(approvalNeedsBranch(escalation(), "/bin/zsh -lc 'npm test'")).toBe(false);
    expect(
      approvalNeedsBranch(items.approval("file-change", { prompt: "git push" }), undefined),
    ).toBe(false);
  });
});

describe("describeRuntimeRequest — the real project folder beside a private copy", () => {
  const copy = "/Users/kid/.skycot/worktrees/foreman demo cafe/skycot-footer-1a2b";
  const real = "/Users/kid/Sites/foreman demo cafe";
  const ctx = { projectRoot: copy, projectFolder: real };

  it("asks about an edit to the real folder with the honest Undo sentence", () => {
    const card = describeRuntimeRequest(
      items.approval("file-change", { prompt: `update ${real}/index.html` }),
      ctx,
    );
    expect(card.title).toBe(REAL_PROJECT_TITLE);
    expect(card.risk).toBe("medium");
    expect(card.warning).toBe(REAL_PROJECT_WARNING);
    expect(card.warning).toContain("which Undo can't reverse");
    expect(card.scopeExplainer).toBe(
      "Your real project folder — not the private copy this conversation works in.",
    );
    expect(decisions(card)).not.toContain("acceptAlways");
  });

  it("asks about a command that writes there, but not one that only looks", () => {
    const writes = describeRuntimeRequest(
      items.approval("command", { prompt: `sed -i '' 's/a/b/' "${real}/index.html"` }),
      ctx,
    );
    expect(writes.title).toBe(REAL_PROJECT_TITLE);
    expect(writes.risk).toBe("medium");
    expect(writes.whyItMatters).toContain("changes your real project, which Undo can't reverse");
    const looks = describeRuntimeRequest(
      items.approval("command", { prompt: `cat "${real}/index.html"` }),
      ctx,
    );
    expect(looks.title).not.toBe(REAL_PROJECT_TITLE);
    expect(looks.warning).toBeUndefined();
  });

  it("keeps the ordinary card inside the private copy", () => {
    const card = describeRuntimeRequest(
      items.approval("file-change", { prompt: `update ${copy}/index.html` }),
      ctx,
    );
    expect(card.title).toBe("May I change this file?");
    expect(card.risk).toBe("low");
  });
});
