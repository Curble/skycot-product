import { describe, expect, it } from "vite-plus/test";

import { CREW_NAME } from "../brand";
import { BUILT_IN_THEMES, CLASSIC_THEME } from "./library";
import { crewFor, NEUTRAL_CREW, possessive } from "./useCrew";

const workshop = BUILT_IN_THEMES.find((theme) => theme.id === "workshop")!;

describe("crewFor", () => {
  it("falls back to the neutral Crew when there is no theme", () => {
    expect(crewFor(null)).toBe(NEUTRAL_CREW);
    expect(NEUTRAL_CREW.builder.name).toBe(CREW_NAME);
    expect(NEUTRAL_CREW.named).toBe(false);
  });

  it("stays neutral for a theme without a crew, but still reports its flavour", () => {
    const crew = crewFor(CLASSIC_THEME);
    expect(crew.named).toBe(false);
    expect(crew.builder.name).toBe(CREW_NAME);
    expect(crew.checker.name).toBe(CREW_NAME);
    expect(crew.characters).toBe(false);
    expect(crew.playful).toBe(false);
  });

  it("names Sam and Mo for Workshop with their colours and emoji", () => {
    const crew = crewFor(workshop);
    expect(crew.named).toBe(true);
    expect(crew.builder).toEqual({ name: "Sam", color: "#f26b4e", emoji: "🔨" });
    expect(crew.checker).toEqual({ name: "Mo", color: "#3fa66f", emoji: "🔍" });
    expect(crew.characters).toBe(true);
    expect(crew.playful).toBe(true);
  });

  it("a crew without emoji yields null, never undefined", () => {
    const crew = crewFor({
      ...CLASSIC_THEME,
      crew: { builder: { name: "Ada", color: "#000" }, checker: { name: "Lin", color: "#fff" } },
    });
    expect(crew.builder.emoji).toBeNull();
    expect(crew.named).toBe(true);
  });
});

describe("possessive", () => {
  it("adds 's, or just an apostrophe after an s", () => {
    expect(possessive("Mo")).toBe("Mo's");
    expect(possessive("Chris")).toBe("Chris'");
    expect(possessive("Crew")).toBe("Crew's");
  });
});
