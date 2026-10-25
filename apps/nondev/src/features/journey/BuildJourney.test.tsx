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
  readBuildWord: () => null,
  rememberBuildWord: () => {},
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
    async rerender(node: ReactNode) {
      await act(async () => root.render(node));
    },
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
    expect(onTellSam).toHaveBeenCalledWith("Can you fix the bug?");
    await page.unmount();
  });
  it("keeps an unanswered question through Finish, then offers the next question", async () => {
    const early = { ...projection, turnItems: projection.turnItems.slice(0, 1) };
    const page = await mount(<BuildJourney projection={early} elapsedMs={0} />);
    const question = page.host.querySelector(".fm-journey__think p")?.textContent;
    await page.rerender(<BuildJourney projection={projection} elapsedMs={30_000} finished />);
    expect(page.host.textContent).toContain("Sam has finished!");
    expect(page.host.querySelector(".fm-journey__think p")?.textContent).toBe(question);
    await page.click(".fm-journey__answers button");
    await page.click(".fm-journey__again");
    expect(page.host.querySelector(".fm-journey__think p")?.textContent).toBe(
      "What would make it even better?",
    );
    await page.unmount();
  });

  it("chooses one word per run, waits for evidence, and chooses at Finish if necessary", async () => {
    const empty = { ...projection, turnItems: [] };
    const page = await mount(
      <BuildJourney key="new" runId="new" projection={projection} elapsedMs={0} />,
    );
    // A new run can start before its first item reaches the client: old runs cannot choose its word.
    expect(page.host.querySelector(".fm-journey__word")).toBeNull();
    await page.rerender(
      <BuildJourney
        key="build"
        projection={{
          ...projection,
          turnItems: projection.turnItems
            .slice(0, 1)
            .map((item) => ({ ...item, fileName: "page.html", newStr: "<h1>Hello</h1>" })),
        }}
        elapsedMs={0}
      />,
    );
    const word = page.host.querySelector(".fm-journey__word h3")?.textContent;
    expect(word).toBe("page");
    await page.rerender(
      <BuildJourney key="build" projection={projection} elapsedMs={30_000} finished />,
    );
    expect(page.host.querySelector(".fm-journey__word h3")?.textContent).toBe(word);
    await page.rerender(<BuildJourney key="next" projection={empty} elapsedMs={0} finished />);
    expect(page.host.querySelector(".fm-journey__word h3")?.textContent).toBe("plan");
    await page.unmount();
  });

  it("offers a page change in the child's voice after a birthday card build", async () => {
    const onTellSam = vi.fn();
    const page = await mount(
      <BuildJourney projection={projection} elapsedMs={0} finished onTellSam={onTellSam} />,
    );
    await page.click(".fm-journey__answers button");
    await page.click(".fm-journey__tell");
    expect(onTellSam).toHaveBeenCalledWith("Can you add more colour?");
    expect(page.host.textContent).not.toContain("A new level");
    await page.unmount();
  });
});
