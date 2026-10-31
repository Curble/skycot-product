// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  band: "makers" as string,
  buildHelp: null as string | null,
  enabled: true,
  hasChild: true,
}));
const saved = vi.hoisted(() => vi.fn());
vi.mock("../../themes/useCrew", () => ({
  useCrew: () => ({ named: true, playful: true, builder: { name: "Sam" } }),
}));
vi.mock("../family/store", () => ({
  saveOwnBuildHelp: (level: string | null) => {
    saved(level);
    return Promise.resolve({ ok: true });
  },
}));
vi.mock("../family/FamilyProvider", () => ({
  useFamily: () => ({
    enabled: state.enabled,
    profile: {
      currentChildId: state.hasChild ? "kid" : null,
      children: [{ id: "kid", readingLevel: state.band, buildHelp: state.buildHelp }],
    },
  }),
}));

import { useStarterPick } from "./BuildHelpSheet";
import { KID_STARTERS } from "./starters";

let root: Root | null = null;

async function mount(node: React.ReactElement) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const host = document.createElement("div");
  host.id = "root";
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  state.band = "makers";
  state.buildHelp = null;
  state.enabled = true;
  state.hasChild = true;
  saved.mockReset();
});

const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) =>
      el.getAttribute("aria-label") === name ||
      el.textContent?.trim() === name ||
      el.getAttribute("aria-label")?.startsWith(`${name}.`) === true,
  )!;
const click = async (name: string) => {
  const target = button(name);
  if (target === undefined) throw new Error(`No button called ${name}`);
  await act(async () => target.click());
};
const title = () => document.querySelector(".fm-sheet__title")?.textContent;
const dialog = () => document.querySelector('[role="dialog"]');

function Probe({ setSeed }: { setSeed: (seed: { text: string; starterId: string }) => void }) {
  const { pick, sheet } = useStarterPick(setSeed as never);
  return (
    <>
      {KID_STARTERS.map((starter) => (
        <button key={starter.id} type="button" data-card={starter.id} onClick={() => pick(starter)}>
          {starter.title}
        </button>
      ))}
      {sheet}
    </>
  );
}

describe("build help, first tap", () => {
  it("opens the choose-your-path screen first, marking the age band's level, and saves a pick", async () => {
    state.band = "little-makers";
    const setSeed = vi.fn();
    await mount(<Probe setSeed={setSeed} />);
    await click("Make a game");
    expect(setSeed).not.toHaveBeenCalled();
    expect(title()).toBe("How shall we build it?");
    expect(document.activeElement).toBe(document.querySelector(".fm-sheet__title"));
    const cards = [...document.querySelectorAll<HTMLButtonElement>(".fm-bh__path")];
    expect(cards.map((card) => card.dataset["level"])).toEqual(["pictures", "words", "builder"]);
    expect(cards.map((card) => card.hasAttribute("data-marked"))).toEqual([true, false, false]);
    expect(document.querySelector(".fm-bh__stamp")?.textContent).toBe("Good start");
    await click("Words");
    expect(saved).toHaveBeenCalledWith("words");
    expect(title()).toBe("What kind of game?");
  });

  it("marks Words for the middle band and Builder for the oldest", async () => {
    await mount(<Probe setSeed={vi.fn()} />);
    await click("Make a game");
    expect(document.querySelector(".fm-bh__path[data-marked]")?.getAttribute("data-level")).toBe(
      "words",
    );
    await act(async () => root!.unmount());
    state.band = "big-makers";
    root = createRoot(document.getElementById("root")!);
    await act(async () => root!.render(<Probe setSeed={vi.fn()} />));
    await click("Make a game");
    expect(document.querySelector(".fm-bh__path[data-marked]")?.getAttribute("data-level")).toBe(
      "builder",
    );
  });

  it("Just type it myself fills the box with the plain card sentence and closes", async () => {
    const setSeed = vi.fn();
    await mount(<Probe setSeed={setSeed} />);
    await click("Make a game");
    await click("Just type it myself");
    expect(setSeed).toHaveBeenCalledTimes(1);
    expect(setSeed.mock.calls[0]![0].text).toContain("[");
    expect(setSeed.mock.calls[0]![0].sendNow).toBeUndefined();
    expect(dialog()).toBeNull();
    expect(saved).not.toHaveBeenCalled();
  });
});

describe("build help, remembered level", () => {
  it("opens Pictures straight away when that is what the child chose", async () => {
    state.buildHelp = "pictures";
    const setSeed = vi.fn();
    await mount(<Probe setSeed={setSeed} />);
    await click("Make a game");
    expect(title()).toBe("What kind of game?");
    await act(async () => button("Snake").click());
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await click("Make it!");
    expect(setSeed.mock.calls[0]![0].text).toContain("play in the page: snake.");
    expect(setSeed.mock.calls[0]![0].sendNow).toBe(true);
    expect(dialog()).toBeNull();
  });

  it("opens Words straight away, builds the sentence live, and Make it! sends it", async () => {
    state.buildHelp = "words";
    const setSeed = vi.fn();
    await mount(<Probe setSeed={setSeed} />);
    await click("Make a game");
    expect(title()).toBe("What kind of game?");
    expect(document.querySelector(".fm-words__sentence")?.textContent).toContain("your game");
    expect(button("Next").disabled).toBe(true);
    await click("A maze");
    expect(document.querySelector(".fm-words__sentence")?.textContent).toContain("a maze");
    expect(button("A maze").getAttribute("aria-pressed")).toBe("true");
    await click("Next");
    expect(title()).toBe("Where, and how?");
    expect(document.activeElement).toBe(document.querySelector(".fm-sheet__title"));
    await click("Under the sea");
    await click("The arrow keys");
    expect(document.querySelector(".fm-words__sentence")?.textContent).toContain(
      "a maze, under the sea. Use the arrow keys, keep score",
    );
    await click("Next");
    expect(title()).toBe("Add a twist?");
    await click("It gets faster and faster");
    await click("Funny sounds");
    await click("A surprise ending");
    // Only two at a time: the first one dropped off.
    expect(button("It gets faster and faster").getAttribute("aria-pressed")).toBe("false");
    await click("Next");
    expect(title()).toBe("Ready when you are");
    await click("Make it!");
    const seed = setSeed.mock.calls[0]![0];
    expect(seed.sendNow).toBe(true);
    expect(seed.starterId).toBe("game");
    expect(seed.text).toBe(
      "Please make a simple game I can play in the page: a maze, under the sea. Use the arrow keys, keep score, and show a big “Play again” button at the end. Add a twist: funny sounds and a surprise ending.",
    );
    expect(dialog()).toBeNull();
  });

  it("lets the child skip the twist with No twist, thanks", async () => {
    state.buildHelp = "words";
    const setSeed = vi.fn();
    await mount(<Probe setSeed={setSeed} />);
    await click("A page about my pet");
    await click("Rabbit");
    await click("Luna");
    await click("Next");
    await click("Next");
    expect(title()).toBe("Add a twist?");
    // One tap: no twist moves straight on to the review screen.
    await click("No twist, thanks");
    expect(title()).toBe("Ready when you are");
    await click("Make it!");
    const text: string = setSeed.mock.calls[0]![0].text;
    expect(text).toContain("a rabbit called Luna.");
    expect(text).not.toContain("twist");
  });

  it("opens Builder, ticks parts, writes it up as an editable sentence and Send hands it over", async () => {
    state.buildHelp = "builder";
    const setSeed = vi.fn();
    await mount(<Probe setSeed={setSeed} />);
    await click("Make a game");
    expect(title()).toBe("Pick the parts");
    const tick = async (name: string) =>
      act(async () =>
        [...document.querySelectorAll<HTMLLabelElement>(".fm-builder__check")]
          .find((label) => label.textContent?.includes(name))!
          .querySelector("input")!
          .click(),
      );
    const gameBox = document.querySelector<HTMLInputElement>(".fm-builder__blank input")!;
    expect(gameBox.value).toBe("");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        gameBox,
        "catch the falling stars",
      );
      gameBox.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await tick("Levels");
    await tick("Timer");
    await click("Longer timer");
    expect(document.querySelector(".fm-builder__count")?.textContent).toContain("2 picked");
    await click("Write it up");
    expect(title()).toBe("Read it, change it");
    const box = document.querySelector<HTMLTextAreaElement>(".fm-builder__text")!;
    expect(box.value).toContain("Also add: levels that get harder and a 75-second timer.");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        box,
        `${box.value} Make the stars sparkle.`,
      );
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Going back and forth without touching the parts keeps the child's own words.
    await click("Back to the parts");
    expect(title()).toBe("Pick the parts");
    await click("Write it up");
    expect(document.querySelector<HTMLTextAreaElement>(".fm-builder__text")!.value).toContain(
      "Make the stars sparkle.",
    );
    expect(setSeed).not.toHaveBeenCalled();
    await click("Send");
    const seed = setSeed.mock.calls[0]![0];
    expect(seed.sendNow).toBe(true);
    expect(seed.text).toContain("catch the falling stars");
    expect(seed.text).toContain("Make the stars sparkle.");
    expect(dialog()).toBeNull();
  });
});

describe("Builder with empty boxes", () => {
  it("never writes the grey examples into the sentence", async () => {
    state.buildHelp = "builder";
    await mount(<Probe setSeed={vi.fn()} />);
    await click("A birthday card");
    const boxes = [...document.querySelectorAll<HTMLInputElement>(".fm-builder__blank input")];
    expect(boxes.map((box) => box.value)).toEqual(["", ""]);
    expect(boxes[0]!.placeholder).toContain("my Nan");
    await act(async () =>
      document.querySelector<HTMLInputElement>(".fm-builder__check input")!.click(),
    );
    await click("Write it up");
    const text = document.querySelector<HTMLTextAreaElement>(".fm-builder__text")!.value;
    expect(text).toContain("Please make a birthday card page. Make it bright");
    expect(text).not.toContain("my Nan");
    expect(text).not.toMatch(/turning|\[/);
  });
});

describe("Change how I build", () => {
  it("is a labelled button in every level's header and reopens the chooser; a new pick is saved and used", async () => {
    state.buildHelp = "words";
    await mount(<Probe setSeed={vi.fn()} />);
    await click("Make a game");
    expect(title()).toBe("What kind of game?");
    await click("Change how I build");
    expect(title()).toBe("How shall we build it?");
    expect(document.querySelector(".fm-bh__stamp")?.textContent).toBe("Your pick");
    expect(document.querySelector(".fm-bh__path[data-marked]")?.getAttribute("data-level")).toBe(
      "words",
    );
    await click("Builder");
    expect(saved).toHaveBeenCalledWith("builder");
    expect(title()).toBe("Pick the parts");
    await click("Change how I build");
    await click("Pictures");
    expect(saved).toHaveBeenLastCalledWith("pictures");
    expect(title()).toBe("What kind of game?");
    expect(document.querySelector('[data-screen="step"]')?.className).toContain("fm-picker");
  });

  it("is there on Pictures, Words and Builder", async () => {
    for (const level of ["pictures", "words", "builder"]) {
      state.buildHelp = level;
      await mount(<Probe setSeed={vi.fn()} />);
      await click("Make a game");
      expect(button("Change how I build"), level).toBeDefined();
      expect(button("Just type it myself"), level).toBeDefined();
      await act(async () => root?.unmount());
      root = null;
      document.body.innerHTML = "";
    }
  });

  it("remembers the pick for the next tap in the same visit, before the engine answers", async () => {
    await mount(<Probe setSeed={vi.fn()} />);
    await click("Make a game");
    await click("Builder");
    await click("Close");
    expect(dialog()).toBeNull();
    await click("A birthday card");
    expect(title()).toBe("Pick the parts");
  });
});

describe("cards that do not get build help", () => {
  it("keeps today's behaviour for Surprise me", async () => {
    const setSeed = vi.fn();
    await mount(<Probe setSeed={setSeed} />);
    await click("Surprise me");
    expect(setSeed).toHaveBeenCalledTimes(1);
    expect(setSeed.mock.calls[0]![0].sendNow).toBeUndefined();
    expect(dialog()).toBeNull();
  });

  it("keeps today's behaviour when no child is using SKYCOT or the profile is off", async () => {
    state.hasChild = false;
    const setSeed = vi.fn();
    await mount(<Probe setSeed={setSeed} />);
    await click("Make a game");
    expect(setSeed).toHaveBeenCalledTimes(1);
    expect(setSeed.mock.calls[0]![0].text).toContain("[");
    expect(dialog()).toBeNull();
    state.hasChild = true;
    state.enabled = false;
    await click("Make a game");
    expect(setSeed).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
  });
});
