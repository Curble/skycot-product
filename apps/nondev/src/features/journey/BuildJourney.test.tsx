// @vitest-environment jsdom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";

const state = vi.hoisted(() => ({
  level: "makers" as "makers" | "big-makers",
  known: [] as string[],
}));
vi.mock("../family/FamilyProvider", () => ({
  useFamily: () => ({
    enabled: true,
    profile: {
      currentChildId: "ava",
      children: [{ id: "ava", name: "Ava", readingLevel: state.level }],
    },
  }),
}));
vi.mock("../../themes/useCrew", () => ({ useCrew: () => ({ builder: { name: "Sam" } }) }));
vi.mock("../voice/ReadAloud", () => ({ ReadAloudButton: () => <button>Read it to me</button> }));
vi.mock("./words", () => ({
  readKnownWords: () => state.known,
  rememberWord: (_childId: string, word: string) => (state.known = [...state.known, word]),
}));

import { BuildJourney } from "./BuildJourney";

const projection = {
  turnItems: [
    {
      runId: "build",
      type: "file_change",
      fileName: "maze.html",
      additions: 156,
      newStr: "let score = 0;\nif (player.x === fish.x) {\n  score += 10;\n}",
    },
    { runId: "build", type: "command_execution", input: "node check.js" },
  ],
} as unknown as OrchestrationV2ThreadProjection;

async function mount(node: ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    async click(selector: string) {
      const button = host.querySelector<HTMLButtonElement>(selector);
      if (!button) throw new Error(`No button found for ${selector}`);
      await act(async () => button.click());
    },
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    },
  };
}

afterEach(() => {
  state.level = "makers";
  state.known = [];
});

describe("Build Journey notebook", () => {
  it("shows done, now and next tabs, level copy, and the word pocket", async () => {
    const page = await mount(<BuildJourney projection={projection} elapsedMs={70_000} />);
    expect(page.host.querySelectorAll(".fm-journey__tabs li[data-state='done']")).toHaveLength(3);
    expect(
      page.host.querySelector(".fm-journey__tabs li[data-state='now'] button")?.textContent,
    ).toContain("Test it");
    expect(
      page.host.querySelector(".fm-journey__tabs li[data-state='next'] button")?.textContent,
    ).toContain("Finish");
    expect(page.host.textContent).toContain("Sam is testing your work");
    expect(page.host.textContent).toContain("Words I know");
    expect(page.host.textContent).toContain("10 more for the Word Wizard sticker");
    expect(page.host.textContent).toContain("Read it to me");
    await page.unmount();

    state.level = "big-makers";
    const big = await mount(<BuildJourney projection={projection} elapsedMs={70_000} />);
    expect(big.host.textContent).toContain("Sam is running an automated test");
    // The code peek shows real lines from this project, never a made-up example.
    expect(big.host.textContent).toContain("score += 10");
    expect(big.host.textContent).toContain("Can you spot the score?");
    await big.unmount();
  });

  it("shows the answer reply and sends a Tell Sam choice", async () => {
    const onTellSam = vi.fn();
    const page = await mount(
      <BuildJourney projection={projection} elapsedMs={0} onTellSam={onTellSam} />,
    );
    await page.click(".fm-journey__answers button");
    expect(page.host.textContent).toContain("Good call. Fixing bugs early is what good makers do.");
    await page.click(".fm-journey__tell");
    expect(onTellSam).toHaveBeenCalledWith(
      "About “Sam found something that could be a bug. What should it do?”: Fix it",
    );
    await page.unmount();
  });
});
