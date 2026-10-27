import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  clearGrownUpReturnChild,
  grownUpReturnChild,
  grownUpSessionFor,
  grownUpSessionStep,
  startGrownUpSession,
} from "./grownUpSession";

afterEach(() => vi.unstubAllGlobals());

const view = (settingsUntil: number | undefined) => ({
  openUntil: settingsUntil === undefined ? {} : { settings: settingsUntil },
  grownUps: [{ id: "mum", name: "Mum", avatar: { kind: "initial", color: "#0071E3" } }],
});

describe("grownUpSessionFor", () => {
  it("is the grown-up only while their code's grant is open", () => {
    expect(grownUpSessionFor("mum", view(2_000) as never, 1_000)).toBe("mum");
    expect(grownUpSessionFor("mum", view(500) as never, 1_000)).toBeNull();
    expect(grownUpSessionFor("mum", view(undefined) as never, 1_000)).toBeNull();
  });

  it("never stands for someone who is not one of the family's grown-ups", () => {
    expect(grownUpSessionFor("ava", view(2_000) as never, 1_000)).toBeNull();
    expect(grownUpSessionFor(null, view(2_000) as never, 1_000)).toBeNull();
  });
});

describe("the grown-up hand-back", () => {
  it("remembers the child for this window and clears it after hand-back", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    startGrownUpSession("mum", "ava");
    expect(grownUpReturnChild()).toBe("ava");
    clearGrownUpReturnChild();
    expect(grownUpReturnChild()).toBeNull();
  });
});

describe("grownUpSessionStep", () => {
  // The marks and grants as the window sees them, in order, for two grown-up visits.
  const run = (frames: ReadonlyArray<readonly [string | null, boolean]>) => {
    let sawOpen = false;
    return frames.map(([id, open]) => {
      const step = grownUpSessionStep(sawOpen, id, open);
      sawOpen = step.sawOpen;
      return step.end;
    });
  };

  it("does not take the mark set just before the grant shows for an ending", () => {
    expect(
      run([
        ["mum", false],
        ["mum", true],
      ]),
    ).toEqual([false, false]);
  });

  it("ends the session when the grant lapses", () => {
    expect(
      run([
        ["mum", false],
        ["mum", true],
        ["mum", false],
      ]),
    ).toEqual([false, false, true]);
  });

  it("keeps the second visit alive after the first was handed back (first parent-code try)", () => {
    expect(
      run([
        ["mum", false],
        ["mum", true],
        [null, false], // Done: mark and grant gone together
        ["mum", false], // the next code: mark first, grant a moment later
        ["mum", true],
      ]),
    ).toEqual([false, false, false, false, false]);
  });
});
