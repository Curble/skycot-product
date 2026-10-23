import { describe, expect, it } from "vite-plus/test";

import {
  choiceLabel,
  choiceOf,
  iconAfterRename,
  iconChoices,
  iconFor,
  monogramLetter,
  pictureColorOf,
  projectChange,
} from "./projectIcons";

describe("monogramLetter", () => {
  it("takes the first letter or digit, as a capital", () => {
    expect(monogramLetter("games")).toBe("G");
    expect(monogramLetter("  3d world")).toBe("3");
    expect(monogramLetter("🚀 rocket")).toBe("R");
    expect(monogramLetter("élan")).toBe("É");
    expect(monogramLetter("🚀 !!")).toBeNull();
  });
});

describe("iconChoices", () => {
  it("offers no icon, six letters on colours, then the emoji", () => {
    const choices = iconChoices("Games");
    expect(choices[0]).toEqual({ kind: "none" });
    expect(choices.filter((choice) => choice.kind === "letter")).toHaveLength(6);
    expect(choices.filter((choice) => choice.kind === "emoji").length).toBeGreaterThan(10);
  });

  it("leaves the letters out when the name has none", () => {
    expect(iconChoices("🚀").some((choice) => choice.kind === "letter")).toBe(false);
  });

  it("names every choice for a screen reader", () => {
    expect(choiceLabel({ kind: "letter", color: "leaf" }, "Games")).toBe("G on leaf green");
    expect(choiceLabel({ kind: "emoji", emoji: "🦖" }, "Games")).toBe("Dinosaur");
    expect(choiceLabel({ kind: "none" }, "Games")).toContain("No icon");
  });
});

describe("iconFor and choiceOf", () => {
  it("round-trips through what the engine stores", () => {
    const letter = iconFor({ kind: "letter", color: "sun" }, "Games");
    expect(letter).toEqual({ kind: "monogram", text: "G", color: "amber" });
    expect(choiceOf(letter)).toEqual({ kind: "letter", color: "sun" });
    const emoji = iconFor({ kind: "emoji", emoji: "🚀" }, "Games");
    expect(emoji).toEqual({ kind: "emoji", emoji: "🚀" });
    expect(choiceOf(emoji)).toEqual({ kind: "emoji", emoji: "🚀" });
    expect(iconFor({ kind: "none" }, "Games")).toBeNull();
    expect(choiceOf(null)).toEqual({ kind: "none" });
  });

  it("doesn't claim an icon from Advanced mode it doesn't offer", () => {
    expect(choiceOf({ kind: "lucide", name: "rocket", color: "red" })).toBeNull();
    expect(choiceOf({ kind: "monogram", text: "G", color: "teal" })).toBeNull();
    expect(choiceOf({ kind: "emoji", emoji: "🧀" })).toBeNull();
  });

  it("draws any engine colour in the nearest picture colour", () => {
    expect(pictureColorOf("teal")).toBe("leaf");
    expect(pictureColorOf("rose")).toBe("berry");
    expect(pictureColorOf("gray")).toBeNull();
  });
});

describe("iconAfterRename", () => {
  it("moves a letter icon to the new name's letter, keeping its colour", () => {
    expect(iconAfterRename({ kind: "monogram", text: "G", color: "sky" }, "Games", "Pets")).toEqual(
      { kind: "monogram", text: "P", color: "sky" },
    );
  });

  it("leaves other icons and hand-picked letters alone", () => {
    const emoji = { kind: "emoji", emoji: "🚀" } as const;
    expect(iconAfterRename(emoji, "Games", "Pets")).toBe(emoji);
    const picked = { kind: "monogram", text: "XY", color: "sky" } as const;
    expect(iconAfterRename(picked, "Games", "Pets")).toBe(picked);
    expect(iconAfterRename(null, "Games", "Pets")).toBeNull();
  });
});

describe("projectChange", () => {
  const current = { title: "Games", projectIcon: null };

  it("sends only what changed", () => {
    expect(projectChange({ current, typed: " Space  games ", choice: { kind: "none" } })).toEqual({
      ok: true,
      change: { title: "Space games" },
    });
    expect(
      projectChange({ current, typed: "Games", choice: { kind: "emoji", emoji: "🚀" } }),
    ).toEqual({ ok: true, change: { projectIcon: { kind: "emoji", emoji: "🚀" } } });
    expect(projectChange({ current, typed: "Games", choice: { kind: "none" } })).toEqual({
      ok: true,
      change: {},
    });
  });

  it("refuses a blank name", () => {
    expect(projectChange({ current, typed: "   ", choice: null })).toEqual({
      ok: false,
      reason: "Type a name first.",
    });
  });

  it("a renamed letter icon follows the new name", () => {
    const lettered = {
      title: "Games",
      projectIcon: iconFor({ kind: "letter", color: "berry" }, "Games"),
    };
    expect(
      projectChange({
        current: lettered,
        typed: "Pets",
        choice: { kind: "letter", color: "berry" },
      }),
    ).toEqual({
      ok: true,
      change: { title: "Pets", projectIcon: { kind: "monogram", text: "P", color: "pink" } },
    });
  });

  it("keeps an Advanced-mode icon when the grid offers nothing like it", () => {
    const lucide = {
      title: "Games",
      projectIcon: { kind: "lucide", name: "rocket", color: "red" } as const,
    };
    expect(projectChange({ current: lucide, typed: "Pets", choice: null })).toEqual({
      ok: true,
      change: { title: "Pets" },
    });
  });
});
