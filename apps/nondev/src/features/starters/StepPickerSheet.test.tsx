// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../themes/useCrew", () => ({
  useCrew: () => ({ named: true, playful: true, builder: { name: "Sam" } }),
}));

import { choicesFor } from "./choices";
import { StepPickerSheet } from "./StepPickerSheet";
import { KID_STARTERS } from "./starters";

const find = (id: string) => KID_STARTERS.find((starter) => starter.id === id)!;
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
});

const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) => el.getAttribute("aria-label") === name || el.textContent?.trim() === name,
  )!;
const click = async (name: string) => {
  await act(async () => button(name).click());
};
const settle = async () => {
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
};
const title = () => document.querySelector(".fm-sheet__title")?.textContent;

describe("step picker sheet", () => {
  it("shows a dialog with the question, eight tiles and the two special cards", async () => {
    await mount(<StepPickerSheet starter={find("game")} onClose={() => {}} onMake={() => {}} />);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(title()).toBe("What kind of game?");
    const tiles = document.querySelectorAll(".fm-picker__tile");
    expect(tiles.length).toBe(10);
    expect(button("Surprise me")).toBeDefined();
    expect(button("Type it")).toBeDefined();
    expect(button("Catch the falling stars").getAttribute("aria-pressed")).toBe("false");
  });

  it("advances after a tile, then Make it! hands over the finished sentence", async () => {
    const onMake = vi.fn();
    await mount(<StepPickerSheet starter={find("pet")} onClose={() => {}} onMake={onMake} />);
    await click("Rabbit");
    expect(title()).toBe("What animal is it?");
    await settle();
    expect(title()).toBe("What's its name?");
    await click("Luna");
    await settle();
    expect(title()).toBe("Here's what Sam will make");
    expect(document.body.textContent).toContain("a rabbit called Luna");
    expect(document.querySelectorAll(".fm-picker__chip").length).toBe(2);
    await click("Make it!");
    expect(onMake).toHaveBeenCalledTimes(1);
    expect(onMake.mock.calls[0]![0]).toContain("a rabbit called Luna");
    expect(onMake.mock.calls[0]![0]).not.toContain("[");
  });

  it("un-chooses a tile when it is tapped again, and Back keeps answers", async () => {
    await mount(<StepPickerSheet starter={find("pet")} onClose={() => {}} onMake={() => {}} />);
    await click("Cat");
    await click("Cat");
    await settle();
    expect(title()).toBe("What animal is it?");
    expect(button("Cat").getAttribute("aria-pressed")).toBe("false");
    await click("Dog");
    await settle();
    await click("Back");
    expect(title()).toBe("What animal is it?");
    expect(button("Dog").getAttribute("aria-pressed")).toBe("true");
  });

  it("rolls the dice, shows the pick chosen, and re-rolls", async () => {
    const values = [0, 0.99];
    await mount(
      <StepPickerSheet
        starter={find("school")}
        onClose={() => {}}
        onMake={() => {}}
        random={() => values.shift() ?? 0}
      />,
    );
    await click("Surprise me");
    const first = choicesFor("school")[0]!.choices;
    expect(
      button(first[0]!.label.replace(/^./, (c) => c.toUpperCase())).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(title()).toBe("What is it about?");
    await settle();
    expect(title()).toBe("What is it about?");
    await click("Surprise me, roll again");
    const last = first[first.length - 1]!.label;
    expect(button(last.replace(/^./, (c) => c.toUpperCase())).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await click("Next");
    expect(title()).toBe("Here's what Sam will make");
    expect(document.body.textContent).toContain(`about ${last}`);
  });

  it("lets a child type their own answer, and ignores an empty one", async () => {
    const onMake = vi.fn();
    await mount(<StepPickerSheet starter={find("comic")} onClose={() => {}} onMake={onMake} />);
    await click("Type it");
    const input = document.querySelector<HTMLInputElement>("#fm-picker-type")!;
    expect(document.querySelector('label[for="fm-picker-type"]')).not.toBeNull();
    await click("Done");
    await settle();
    expect(title()).toBe("What happens?");
    await click("Type it");
    const field = document.querySelector<HTMLInputElement>("#fm-picker-type")!;
    expect(field).not.toBe(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        field,
        "a frog on a skateboard",
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Done");
    await settle();
    expect(title()).toBe("Here's what Sam will make");
    await click("Make it!");
    expect(onMake.mock.calls[0]![0]).toContain("comic strip about a frog on a skateboard.");
  });

  it("Change my mind goes back to the first step and Close abandons", async () => {
    const onClose = vi.fn();
    const onMake = vi.fn();
    await mount(<StepPickerSheet starter={find("game")} onClose={onClose} onMake={onMake} />);
    await click("A maze");
    await settle();
    await click("Change my mind");
    expect(title()).toBe("What kind of game?");
    expect(button("A maze").getAttribute("aria-pressed")).toBe("true");
    await click("Close");
    expect(onClose).toHaveBeenCalled();
    expect(onMake).not.toHaveBeenCalled();
  });
});

describe("step picker sheet, inside build help", () => {
  it("shows Change how I build and Just type it myself when given, and they call back", async () => {
    const onChangeHow = vi.fn();
    const onTypeMyself = vi.fn();
    await mount(
      <StepPickerSheet
        starter={find("game")}
        onClose={() => {}}
        onMake={() => {}}
        onChangeHow={onChangeHow}
        onTypeMyself={onTypeMyself}
      />,
    );
    await click("Change how I build");
    expect(onChangeHow).toHaveBeenCalledTimes(1);
    await click("Just type it myself");
    expect(onTypeMyself).toHaveBeenCalledTimes(1);
  });

  it("puts focus on the sheet title when it opens", async () => {
    await mount(<StepPickerSheet starter={find("game")} onClose={() => {}} onMake={() => {}} />);
    expect(document.activeElement).toBe(document.querySelector(".fm-sheet__title"));
  });
});
