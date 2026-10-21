import { describe, expect, it } from "vite-plus/test";

import { items } from "../../../plain/fixtures.test-helpers";
import { groupTimelineItems } from "./grouping";

describe("groupTimelineItems", () => {
  it("folds a run's tool activity into one card placed at the first tool item", () => {
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
      "work",
      "approval_request",
      "assistant_message",
    ]);
    const work = entries[2]!;
    expect(work.kind === "work" && work.items.map((i) => i.type)).toEqual([
      "reasoning",
      "command_execution",
      "file_change",
    ]);
    expect(work.kind === "work" && work.index).toBe(2);
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
});
