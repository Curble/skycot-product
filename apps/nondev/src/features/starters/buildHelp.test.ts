import { describe, expect, it } from "vite-plus/test";

import {
  BUILD_HELP_INFO,
  buildHelpInfo,
  buildHelpLine,
  firstScreen,
  hasBuildHelp,
  levelForBand,
} from "./buildHelp";
import { blankCount } from "./choices";
import { KID_STARTERS } from "./starters";

describe("levelForBand", () => {
  it("starts each age band at its own level", () => {
    expect(levelForBand("little-makers")).toBe("pictures");
    expect(levelForBand("makers")).toBe("words");
    expect(levelForBand("big-makers")).toBe("builder");
  });
  it("starts an unknown band at Words", () => {
    expect(levelForBand(undefined)).toBe("words");
    expect(levelForBand(null)).toBe("words");
  });
});

describe("firstScreen", () => {
  it("opens the chooser the first time, with the age band's level suggested", () => {
    expect(firstScreen({ stored: null, band: "little-makers" })).toEqual({
      screen: "chooser",
      suggested: "pictures",
    });
    expect(firstScreen({ stored: undefined, band: "makers" })).toEqual({
      screen: "chooser",
      suggested: "words",
    });
    expect(firstScreen({ stored: null, band: "big-makers" })).toEqual({
      screen: "chooser",
      suggested: "builder",
    });
  });
  it("opens straight into the remembered level, whatever the age band says", () => {
    expect(firstScreen({ stored: "builder", band: "little-makers" })).toEqual({
      screen: "builder",
      suggested: "pictures",
    });
    expect(firstScreen({ stored: "pictures", band: "big-makers" }).screen).toBe("pictures");
    expect(firstScreen({ stored: "words", band: "makers" }).screen).toBe("words");
  });
});

describe("names and lines", () => {
  it("names the three levels", () => {
    expect(BUILD_HELP_INFO.map((info) => info.name)).toEqual(["Pictures", "Words", "Builder"]);
    expect(buildHelpInfo("words").blurb).toMatch(/words/i);
  });
  it("never mentions an age number or 'kids' in what a child reads", () => {
    for (const info of BUILD_HELP_INFO) {
      expect(`${info.name} ${info.blurb}`).not.toMatch(/\d|kid|child/i);
    }
  });
  it("tells a grown-up where build help starts", () => {
    expect(buildHelpLine("words", "little-makers")).toBe("Build help starts at Words");
    expect(buildHelpLine(null, "big-makers")).toBe("Build help follows the age band (Builder)");
    expect(buildHelpLine(undefined, "makers")).toBe("Build help follows the age band (Words)");
  });
});

describe("hasBuildHelp", () => {
  it("is true for every kids' card with blanks, and false for Surprise me", () => {
    for (const starter of KID_STARTERS) {
      expect(hasBuildHelp(starter.id)).toBe(blankCount(starter.ask) > 0);
    }
    expect(hasBuildHelp("surprise")).toBe(false);
    expect(hasBuildHelp("nope")).toBe(false);
  });
});
