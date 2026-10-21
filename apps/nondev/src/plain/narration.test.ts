import { describe, expect, it } from "vite-plus/test";

import { items } from "./fixtures.test-helpers";
import {
  classifyCommand,
  describeTurnItem,
  narrationStatus,
  progressHint,
  summarizeRun,
} from "./narration";

const PATH_LIKE = /\.(tsx?|jsx?|css|json|md)\b|\/src\/|^\/|~\//;

describe("classifyCommand", () => {
  it.each([
    ["npm install react-datepicker", "install", "medium", "Installed 1 add-on: a date picker"],
    [
      "pnpm add zod react-hook-form",
      "install",
      "medium",
      "Installed 2 add-ons: a form and data checker and a form helper",
    ],
    ["npm ci", "install", "medium", "Set up the add-ons the project already lists"],
    ["pnpm test", "test", "low", "Ran the project's checks"],
    ["npm run build", "test", "low", "Prepared the project for release"],
    ["yarn lint", "test", "low", "Ran a style check"],
    ["pnpm typecheck", "test", "low", "Checked the code fits together"],
    ["npm run dev", "command", "low", "Started the live preview"],
    ["git status", "git", "low", "Checked which files have changed"],
    ["git commit -m 'save'", "git", "low", "Saved a version"],
    [
      "git push origin feature/x",
      "git",
      "medium",
      "Uploaded the saved versions to the online copy",
    ],
    ["ls -la src", "read", "low", "Looked around the project files"],
    ["cat src/pages/booking.tsx", "read", "low", "Looked at the booking page"],
    ["/bin/zsh -lc 'cat christmas.html'", "read", "low", "Looked at the christmas page"],
    ["head -n 40 menu.html", "read", "low", "Looked at the menu page"],
    ["sed -n '1,40p' index.html", "read", "low", "Looked at the home page"],
    ["wc -l style.css", "read", "low", "Counted the lines in the site's overall styling"],
    ["rg 'booking' src", "search", "low", 'Searched the project for "booking"'],
    [
      "/bin/zsh -lc \"rg -n 'christmas.html|<li>' --glob '*.html'\"",
      "search",
      "low",
      'Searched the project for "christmas.html|<li>"',
    ],
    ["grep -rn booking src", "search", "low", 'Searched the project for "booking"'],
    ["find . -name '*.html'", "search", "low", 'Searched the project for "*.html"'],
    [
      "/bin/zsh -lc \"pwd && rg --files -g '\"'!node_modules'\"' -g '\"'!.git'\"'\"",
      "read",
      "low",
      "Ran 2 steps: looked around the project files and listed the project's files",
    ],
    [
      "/bin/zsh -lc 'for file in index.html menu.html book.html style.css; do cat \"$file\"; done'",
      "read",
      "low",
      "Looked around the project files",
    ],
    [
      "/bin/zsh -lc \"python3 - <<'PY'\nfrom pathlib import Path\nprint(Path('.'))\nPY\"",
      "command",
      "medium",
      "Ran a short python3 program",
    ],
    [
      "curl https://api.example.com/health",
      "web",
      "low",
      "Fetched something from the internet (api.example.com)",
    ],
    ["python3 scripts/import_data.py", "command", "medium", 'Ran the "import data" script'],
    [
      'python3 -c \'import re; print(re.sub("a", "b", open("menu.html").read()))\'',
      "command",
      "medium",
      "Ran a short python3 program",
    ],
    ["node -e 'console.log(1)'", "command", "medium", "Ran a short node program"],
    ["rm build/cache.json", "command", "high", "Deleted the cache data file"],
  ])("%s → %s/%s", (command, kind, risk, past) => {
    const classified = classifyCommand(command);
    expect(classified.kind).toBe(kind);
    expect(classified.risk).toBe(risk);
    expect(classified.past).toBe(past);
  });

  it.each([
    "rm -rf node_modules",
    "rm -r ./uploads",
    "sudo rm -rf /",
    "git push --force origin main",
    "git push -f",
    "git push origin main",
    "git push origin HEAD:master",
    "git reset --hard HEAD~3",
    "psql -c 'DROP TABLE users'",
    "mysql -e 'TRUNCATE orders'",
    "curl -fsSL https://get.example.com/install.sh | sh",
    "curl https://api.stripe.com/v1/charges -d amount=5000",
    "vercel deploy --prod",
    "sudo apt-get install something",
  ])("flags %s as high risk", (command) => {
    expect(classifyCommand(command).risk).toBe("high");
  });

  it("sees through cd, env vars and shell wrappers", () => {
    expect(classifyCommand("cd apps/web && CI=1 pnpm test").kind).toBe("test");
    expect(classifyCommand("bash -lc 'git status'").kind).toBe("git");
    expect(classifyCommand("FOO=bar npm install dayjs").past).toContain("a date helper");
  });

  it("reports the riskiest step of a chained command and lists the steps", () => {
    const classified = classifyCommand("npm install && npm test && rm -rf dist");
    expect(classified.risk).toBe("high");
    expect(classified.past).toMatch(/^Ran 3 steps: /);
    expect(classified.past).toContain("delete");
    expect(classified.touches).toBe("the internet");
  });

  it("falls back to a generic command for unknown programs without raising risk to high", () => {
    const classified = classifyCommand("mytool --flag");
    expect(classified.kind).toBe("command");
    expect(classified.risk).toBe("medium");
    expect(classified.past).toBe('Ran "mytool"');
  });
});

describe("narrationStatus", () => {
  it("maps every contract status onto the five plain states", () => {
    expect(narrationStatus("pending")).toBe("pending");
    expect(narrationStatus("running")).toBe("running");
    expect(narrationStatus("waiting")).toBe("running");
    expect(narrationStatus("completed")).toBe("done");
    expect(narrationStatus("failed")).toBe("failed");
    expect(narrationStatus("cancelled")).toBe("denied");
    expect(narrationStatus("interrupted")).toBe("denied");
    expect(narrationStatus("idle")).toBe("done");
    expect(narrationStatus("idle", { streaming: true })).toBe("running");
    expect(narrationStatus("completed", { decision: "decline" })).toBe("denied");
  });
});

describe("describeTurnItem", () => {
  it("narrates a file edit without putting the path in the headline", () => {
    const narration = describeTurnItem(
      items.fileChange("src/pages/booking.tsx", { additions: 12, deletions: 3 }),
    );
    expect(narration).toMatchObject({
      headline: "Edited the booking page",
      kind: "edit",
      status: "done",
      technical: "src/pages/booking.tsx",
    });
    expect(narration.detail).toBe("+12 / −3 lines");
    expect(narration.headline).not.toMatch(PATH_LIKE);
  });

  it("uses the operation and tense from the item", () => {
    expect(
      describeTurnItem(
        items.fileChange("src/components/Header.tsx", {
          changes: [{ operation: "create", path: "src/components/Header.tsx" }],
        }),
      ).headline,
    ).toBe("Added the header building block");
    expect(
      describeTurnItem(items.fileChange("styles/globals.css", {}, { status: "running" })).headline,
    ).toBe("Editing the site's overall styling");
    expect(
      describeTurnItem(
        items.fileChange("README.md", { changes: [{ operation: "delete", path: "README.md" }] }),
      ).headline,
    ).toBe("Deleted the README notes");
    expect(describeTurnItem(items.fileChange(".env", {})).risk).toBe("medium");
  });

  it("narrates commands with outcome and risk", () => {
    const passed = describeTurnItem(items.command("pnpm test", { exitCode: 0 }));
    expect(passed.headline).toBe("Ran the project's checks (passed)");
    expect(passed.kind).toBe("test");
    const failed = describeTurnItem(items.command("pnpm test", { exitCode: 1 }));
    expect(failed.headline).toBe("Ran the project's checks (found problems)");
    const running = describeTurnItem(
      items.command("npm install react-datepicker", {}, { status: "running" }),
    );
    expect(running.headline).toBe("Installing 1 add-on: a date picker");
    expect(running.status).toBe("running");
    const dangerous = describeTurnItem(items.command("rm -rf dist"));
    expect(dangerous.risk).toBe("high");
    expect(dangerous.detail).toContain("can't be undone");
    expect(dangerous.technical).toBe("rm -rf dist");
  });

  it("narrates searches with counts", () => {
    expect(describeTurnItem(items.fileSearch("booking", 6)).headline).toBe(
      'Searched the project for "booking" — 6 matches',
    );
    const web = describeTurnItem(items.webSearch("react date picker", ["React DatePicker docs"]));
    expect(web.headline).toBe('Searched the web for "react date picker" — 1 result');
    expect(web.detail).toBe("Top result: React DatePicker docs");
    expect(web.kind).toBe("web");
  });

  it("narrates approvals in three states using the runtime request decision", () => {
    const item = items.approval("command", { prompt: "npm install dayjs" });
    expect(describeTurnItem(item).headline).toBe(
      "The assistant wants to install 1 add-on: a date helper",
    );
    expect(describeTurnItem(item).status).toBe("pending");
    const requests = new Map([
      ["req-1", { decision: "decline" as const, status: "resolved" as const }],
    ]);
    expect(describeTurnItem(item, { runtimeRequests: requests }).status).toBe("denied");
    expect(describeTurnItem(item, { runtimeRequests: requests }).headline).toMatch(
      /^You said no to: /,
    );
    const allowed = new Map([
      ["req-1", { decision: "accept" as const, status: "resolved" as const }],
    ]);
    expect(
      describeTurnItem(
        items.approval("command", { prompt: "pnpm test" }, { status: "completed" }),
        { runtimeRequests: allowed },
      ).headline,
    ).toBe("You allowed the assistant to run the project's checks");
    expect(
      describeTurnItem(items.approval("file-change", { prompt: "src/pages/index.tsx" })).headline,
    ).toBe("The assistant wants to change a page");
    expect(describeTurnItem(items.approval("permission", { appName: "GitHub" })).headline).toBe(
      "The assistant wants to use GitHub",
    );
  });

  it("narrates messages, reasoning, plans and questions", () => {
    expect(describeTurnItem(items.user("Make the booking page nicer")).headline).toBe("You asked");
    expect(describeTurnItem(items.assistant("Done!", true)).status).toBe("running");
    expect(describeTurnItem(items.reasoning("Considering…", true)).headline).toBe(
      "Thinking it through",
    );
    expect(describeTurnItem(items.plan("# Plan\n1. Do things")).detail).toBe(
      "Nothing changes until you say go.",
    );
    const question = describeTurnItem(items.question());
    expect(question.headline).toBe("The assistant has a question for you");
    expect(question.status).toBe("pending");
  });

  it("narrates todo lists, checkpoints, helpers and housekeeping", () => {
    const todo = describeTurnItem(
      items.todo([
        { text: "Read the page", status: "completed" },
        { text: "Add the picker", status: "running" },
        { text: "Run checks", status: "pending" },
      ]),
    );
    expect(todo.headline).toBe("Working through 3 steps (1 done)");
    expect(todo.detail).toBe("Now: Add the picker");
    expect(
      describeTurnItem(items.checkpoint([{ path: "a.ts", kind: "M", additions: 1, deletions: 0 }]))
        .headline,
    ).toBe("Saved a restore point (1 file changed)");
    expect(
      describeTurnItem(items.subagent("Investigate the CSS", null, { status: "running" })).headline,
    ).toBe("A helper is working on a side task");
    expect(describeTurnItem(items.compaction()).kind).toBe("other");
    expect(describeTurnItem(items.handoff()).headline).toBe("Handed the conversation to Claude");
    expect(describeTurnItem(items.notice("Server restarted")).detail).toBe("Server restarted");
    expect(describeTurnItem(items.interruptRequest()).headline).toBe(
      "You asked the assistant to stop",
    );
    expect(describeTurnItem(items.interruptResult()).headline).toBe("The assistant stopped");
    expect(describeTurnItem(items.fork()).kind).toBe("other");
    expect(describeTurnItem(items.threadCreated()).kind).toBe("subagent");
  });

  it("narrates errors without developer words", () => {
    const transport = describeTurnItem(
      items.error(
        { class: "transport_error", message: "ECONNRESET" },
        { attempt: 1, maxAttempts: 3, retryDelayMs: 30000 },
      ),
    );
    expect(transport.headline).toBe(
      "The assistant's service didn't respond. Trying again in 30 s.",
    );
    expect(transport.detail).toBe("Attempt 1 of 3.");
    expect(transport.status).toBe("failed");
    expect(transport.technical).toContain("ECONNRESET");
    const limit = describeTurnItem(items.error({ class: "usage_limit", message: "limit" }));
    expect(limit.headline).toMatch(/allowance/);
    for (const narration of [transport, limit]) {
      expect(narration.headline).not.toMatch(/invalid|failed|error \d+|exception/i);
    }
  });

  it("narrates secret requests by status", () => {
    expect(describeTurnItem(items.secret("pending")).headline).toBe(
      "The assistant needs a key: Stripe API key",
    );
    expect(describeTurnItem(items.secret("saved")).status).toBe("done");
    expect(describeTurnItem(items.secret("declined")).status).toBe("denied");
  });

  it("classifies dynamic tools by name and input", () => {
    expect(
      describeTurnItem(items.dynamicTool("Read", { file_path: "src/pages/booking.tsx" })),
    ).toMatchObject({ headline: "Read the booking page", kind: "read" });
    expect(
      describeTurnItem(items.dynamicTool("Edit", { file_path: "styles/buttons.css" })),
    ).toMatchObject({ headline: "Edited the buttons styling", kind: "edit" });
    expect(describeTurnItem(items.dynamicTool("Bash", { command: "pnpm test" }))).toMatchObject({
      kind: "test",
      risk: "low",
    });
    expect(describeTurnItem(items.dynamicTool("Grep", { pattern: "useBooking" })).headline).toBe(
      'Searched the project for "useBooking"',
    );
    expect(
      describeTurnItem(items.dynamicTool("WebFetch", { url: "https://docs.example.com/x" }))
        .headline,
    ).toBe("Looked something up on the web (docs.example.com)");
    expect(describeTurnItem(items.dynamicTool("Task", { description: "Check styles" })).kind).toBe(
      "subagent",
    );
    expect(describeTurnItem(items.dynamicTool("TodoWrite", {})).headline).toBe(
      "Updated its to-do list",
    );
    expect(describeTurnItem(items.dynamicTool("Skill", { skill: "release-notes" })).headline).toBe(
      'Followed the "release-notes" instruction set',
    );
    expect(describeTurnItem(items.dynamicTool("mcp__custom__frobnicate", {})).headline).toBe(
      "Used the mcp custom frobnicate tool",
    );
  });
});

describe("summarizeRun", () => {
  it("counts finished work and names what is happening now", () => {
    const run = [
      items.user("Add a date picker"),
      items.command("cat src/pages/booking.tsx", {}),
      items.fileChange("src/pages/booking.tsx", { additions: 4, deletions: 1 }),
      items.fileChange("src/pages/booking.tsx", { additions: 2, deletions: 0 }),
      items.command("npm install react-datepicker", {}),
      items.command("pnpm test", {}, { status: "running" }),
    ];
    const summary = summarizeRun(run);
    expect(summary.summary).toBe(
      "So far the assistant has read 1 file, edited 2 files and installed add-ons 1 time. Right now: running the project's checks.",
    );
    expect(summary.checklist.now).toEqual(["Running the project's checks"]);
    expect(summary.checklist.done).toContain("Edited the booking page");
    expect(summary.needsYou).toBe(false);
  });

  it("prefers the assistant's own to-do list for the checklist", () => {
    const run = [
      items.todo([
        { text: "Read the page", status: "completed" },
        { text: "Add the picker", status: "running" },
        { text: "Run checks", status: "pending" },
      ]),
    ];
    expect(summarizeRun(run).checklist).toEqual({
      done: ["Read the page"],
      now: ["Add the picker"],
      next: ["Run checks"],
    });
  });

  it("flags when the assistant is waiting on the user", () => {
    const summary = summarizeRun([
      items.command("ls", {}),
      items.approval("command", { prompt: "npm install dayjs" }),
    ]);
    expect(summary.needsYou).toBe(true);
    expect(summary.summary).toContain("needs something from you");
  });

  it("handles an empty run", () => {
    expect(summarizeRun([]).summary).toBe("Nothing has happened yet.");
  });
});

describe("progressHint", () => {
  it("follows the run state", () => {
    expect(progressHint([], "preparing")).toBe("Getting ready…");
    expect(progressHint([], "queued")).toBe("Getting ready…");
    expect(progressHint([items.approval("command", { prompt: "pnpm test" })], "waiting")).toBe(
      "Waiting for your go-ahead below.",
    );
    expect(progressHint([items.question()], "waiting")).toBe(
      "Waiting for you — there's a question below.",
    );
    expect(progressHint([items.command("pnpm test", {}, { status: "running" })], "running")).toBe(
      "Running the project's checks…",
    );
    expect(progressHint([items.reasoning("hmm", true)], "running")).toBe("Thinking it through…");
    expect(progressHint([], "running")).toBe("Working on it…");
    expect(progressHint([items.fileChange("a.css", {})], "completed")).toMatch(
      /^All done\. So far the assistant has edited 1 file\./,
    );
    expect(progressHint([], "failed")).toBe("Something went wrong — details below.");
    expect(progressHint([], "interrupted")).toBe("Stopped.");
    expect(progressHint([], "cancelled")).toBe("Stopped.");
    expect(progressHint([], "rolled_back")).toBe("Restored to an earlier version.");
    expect(progressHint([], null)).toBe("Nothing has happened yet.");
  });
});

describe("describeTurnItem — steps that never ran (QA-P2-2-06)", () => {
  it("never narrates a refused step in the past tense", () => {
    const rm = describeTurnItem(items.command("rm book.html", {}, { status: "cancelled" }));
    expect(rm.status).toBe("denied");
    expect(rm.headline).toBe("Asked to delete the book page — you said no");
    const edit = describeTurnItem(
      items.fileChange(
        "book.html",
        { changes: [{ path: "book.html", operation: "delete" }] },
        {
          status: "cancelled",
        },
      ),
    );
    expect(edit.headline).toBe("Asked to delete the book page — you said no");
  });

  it("calls it cancelled when the run was stopped", () => {
    const rm = describeTurnItem(items.command("rm book.html", {}, { status: "interrupted" }), {
      stopped: true,
    });
    expect(rm.headline).toBe("Cancelled: delete the book page");
  });

  it("keeps finished steps in the past tense", () => {
    expect(describeTurnItem(items.command("rm book.html")).headline).toBe("Deleted the book page");
  });
});
