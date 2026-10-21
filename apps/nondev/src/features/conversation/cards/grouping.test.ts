import { describe, expect, it } from "vite-plus/test";

import { items } from "../../../plain/fixtures.test-helpers";
import { groupTimelineItems } from "./grouping";

describe("groupTimelineItems", () => {
  it("folds a run's tool activity into one card placed after the asks it made", () => {
    const list = [
      items.user("Add a Christmas page"),
      items.assistant("On it."),
      items.reasoning("Looking at the nav"),
      items.command("rg --files"),
      items.approval("command", { prompt: "npm install sharp" }),
      items.fileChange("christmas.html"),
      items.assistant("Done."),
    ];
    const entries = groupTimelineItems(list);
    expect(entries.map((e) => (e.kind === "work" ? "work" : e.item.type))).toEqual([
      "user_message",
      "assistant_message",
      "approval_request",
      "work",
      "assistant_message",
    ]);
    const work = entries[3]!;
    expect(work.kind === "work" && work.items.map((i) => i.type)).toEqual([
      "reasoning",
      "command_execution",
      "file_change",
    ]);
    expect(work.kind === "work" && work.index).toBe(5);
  });

  it("keeps the card where it is while the run only adds tool items", () => {
    const list = [
      items.reasoning("Looking"),
      items.command("ls"),
      items.fileChange("a.html"),
      items.assistant("Done."),
    ];
    const entries = groupTimelineItems(list);
    expect(entries.map((e) => (e.kind === "work" ? "work" : e.item.type))).toEqual([
      "work",
      "assistant_message",
    ]);
  });

  it("keeps separate runs separate", () => {
    const list = [
      items.command("ls", {}, { runId: "run-1" }),
      items.assistant("Done."),
      items.user("Now the nav"),
      items.command("cat index.html", {}, { runId: "run-2" }),
    ];
    const entries = groupTimelineItems(list);
    const works = entries.filter((e) => e.kind === "work");
    expect(works).toHaveLength(2);
    expect(works.map((w) => w.kind === "work" && w.runId)).toEqual(["run-1", "run-2"]);
  });

  it("groups run-less items by adjacency only", () => {
    const list = [
      items.command("ls", {}, { runId: null }),
      items.command("pwd", {}, { runId: null }),
      items.assistant("Hello"),
      items.command("whoami", {}, { runId: null }),
    ];
    const works = groupTimelineItems(list).filter((e) => e.kind === "work");
    expect(works).toHaveLength(2);
    expect(works[0]!.kind === "work" && works[0]!.items).toHaveLength(2);
  });

  it("absorbs the agent's to-do list but not plans, questions or secrets", () => {
    const list = [
      items.todo([{ text: "Read pages", status: "completed" }]),
      items.plan("1. Do it"),
      items.question(),
      items.secret(),
    ];
    const entries = groupTimelineItems(list);
    expect(entries.map((e) => (e.kind === "work" ? "work" : e.item.type))).toEqual([
      "work",
      "proposed_plan",
      "user_input_request",
      "secret_request",
    ]);
  });

  it("folds asks the SKYCOT rules answered into the run's card, which stays last", () => {
    const list = [
      items.user("Check the pages"),
      items.command("ls"),
      items.approval("command", { prompt: "pnpm test", requestId: "req-policy" }),
      items.assistant("All pages open."),
    ];
    const entries = groupTimelineItems(list, {
      absorb: (item) => item.type === "approval_request" && item.requestId === "req-policy",
    });
    expect(entries.map((e) => (e.kind === "work" ? "work" : e.item.type))).toEqual([
      "user_message",
      "work",
      "assistant_message",
    ]);
    const work = entries[1]!;
    expect(work.kind === "work" && work.items.map((i) => i.type)).toEqual([
      "command_execution",
      "approval_request",
    ]);
  });
});

describe("groupTimelineItems — the run's card reads after its answered asks (N-6)", () => {
  it("puts a stopped run's card below the ask that was pending when Stop was pressed", () => {
    const list = [
      items.user("List the files in the project"),
      items.command("Preparing workspace"),
      items.assistant("I'll list the project files."),
      items.command("rg --files", {}, { status: "interrupted" }),
      items.approval("command", { prompt: "rg --files" }, { status: "cancelled" }),
    ];
    const entries = groupTimelineItems(list);
    expect(entries.map((e) => (e.kind === "work" ? "work" : e.item.type))).toEqual([
      "user_message",
      "assistant_message",
      "approval_request",
      "work",
    ]);
  });

  it("keeps a pending ask last, below the live card", () => {
    const list = [
      items.command("rg --files"),
      items.approval("command", { prompt: "npx vercel --prod" }),
    ];
    const entries = groupTimelineItems(list);
    expect(entries.map((e) => (e.kind === "work" ? "work" : e.item.type))).toEqual([
      "work",
      "approval_request",
    ]);
  });
});
