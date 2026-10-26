import { describe, expect, it } from "vite-plus/test";

import {
  rewriteSegments,
  segmentsOf,
  shieldFinding,
  shieldProblem,
  shieldSentence,
  rememberNoFacePictures,
  unknownPictureKeysForChild,
} from "./shield";

const SHOWPIECE = "my name is Ava Smith and I go to St Kilda Primary";

describe("shieldFinding", () => {
  it("catches the showpiece sentence with a one-tap rewrite", () => {
    const finding = shieldFinding(SHOWPIECE);
    expect(finding?.categories).toEqual(["full-name", "school"]);
    expect(finding?.rewrite).toBe("my name is Ava and I go to school");
    expect(finding?.reason).toBe("It shares a full name and a school's name.");
    expect(finding && shieldSentence(finding)).toBe(
      "That looks like a full name and a school's name.",
    );
  });

  it("lets an ordinary message go", () => {
    expect(shieldFinding("Make the title bigger and blue")).toBeNull();
    expect(shieldFinding("Make a game where Mia flies to Mars")).toBeNull();
  });

  it("asks about pictures even when the words are fine", () => {
    const finding = shieldFinding("Put this on the page", 1);
    expect(finding?.categories).toEqual(["photo"]);
    expect(finding?.rewrite).toBeNull();
    expect(finding?.hasPictures).toBe(true);
  });

  it("asks about both together", () => {
    expect(shieldFinding(SHOWPIECE, 2)?.categories).toEqual(["full-name", "school", "photo"]);
  });
});

describe("remembered picture questions", () => {
  it("asks about each unknown picture and keeps no-face answers for known content", () => {
    const remembered = new Map<string, Set<string>>();
    rememberNoFacePictures(remembered, "child-a", ["same", null]);
    expect(unknownPictureKeysForChild(["same", "new", null], remembered, "child-a")).toEqual([
      "new",
      null,
    ]);
    expect(unknownPictureKeysForChild(["same"], remembered, "child-b")).toEqual(["same"]);
  });
});

describe("segments for highlighting", () => {
  it("cuts the message around what was caught", () => {
    const finding = shieldFinding(SHOWPIECE)!;
    expect(segmentsOf(SHOWPIECE, finding.details).map((s) => [s.text, !!s.detail])).toEqual([
      ["my name is ", false],
      ["Ava Smith", true],
      [" and I go to ", false],
      ["St Kilda Primary", true],
    ]);
    expect(
      rewriteSegments(SHOWPIECE, finding.details)
        .map((s) => s.text)
        .join(""),
    ).toBe(finding.rewrite);
  });
});

describe("shieldProblem", () => {
  it("gives a calm line for a short reply", () => {
    expect(shieldProblem("my phone is 0412 345 678")).toBe(
      "That looks like a phone number. Try a nickname instead — your full name, school and address stay private.",
    );
    expect(shieldProblem("the blue one please")).toBeNull();
  });
});
