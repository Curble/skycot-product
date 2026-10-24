import { describe, expect, it } from "vite-plus/test";

import brand from "../../../../../nondev/brand.json";
import { CLI_NAME, PRODUCT_NAME } from "../../brand";
import {
  actionReason,
  codeChangeWarning,
  codeChangedNotice,
  familyCopy,
  familySteps,
  grownUpPlainNames,
} from "./copy";

describe("actionReason", () => {
  // QA FK-13: every card's code sheet said "uses the internet, installs something, deletes…".
  it("gives a grown-up card's own reason on its code sheet", () => {
    const reason = actionReason("approve", "It touches a secrets file or key.");
    expect(reason).toContain("It touches a secrets file or key.");
    expect(reason).not.toMatch(/installs something, deletes/);
    expect(actionReason("approve")).toMatch(/grown-up allows it/);
  });

  it("explains the new grown-up actions", () => {
    expect(actionReason("renameChild")).toMatch(/parent set up/);
    expect(actionReason("saveSecret")).toMatch(/key or password/);
  });
});

describe("brand", () => {
  // QA FK-15: the pairing screen told people to type T3's command.
  it("names the command and product brand.json names", () => {
    expect(CLI_NAME).toBe(brand.cliName);
    expect(PRODUCT_NAME).toBe(brand.productName);
  });
});

describe("grown-up plain names", () => {
  it("uses the child-friendly words in grown-up flows", () => {
    expect(grownUpPlainNames.advanced).toBe("Open the full workshop");
    expect(grownUpPlainNames.trustedAddOns).toBe(
      "Let SKYCOT fetch well-known add-ons (like 3D and drawing tools)",
    );
    expect(grownUpPlainNames.publishLive).toBe("Put it online");
    expect(grownUpPlainNames.publishReview).toBe("Ask someone to check");
    expect(grownUpPlainNames.recapShield).toBe("The private-details check spotted");
  });

  it("warns before changing the code and explains what was signed out", () => {
    expect(codeChangeWarning).toMatch(/signs out Mum's and Dad's phones and Watch/);
    expect(codeChangedNotice).toMatch(/link them again/);
  });
});

describe("how a child's steps are described (Family)", () => {
  it("says safe steps run by themselves by default, and never promises a card for every step", () => {
    const steps = familySteps(false);
    expect(steps.label).toBe("Safe steps");
    expect(steps.description).toBe(
      "Safe steps run by themselves; anything risky waits for a grown-up.",
    );
    for (const line of [familyCopy.safeSteps, steps.description, ...familyCopy.does]) {
      expect(line).not.toMatch(
        /always asks|asks before every|before changing or running anything/i,
      );
    }
  });

  it("says Ask me first when a parent chose it for the child", () => {
    const steps = familySteps(true);
    expect(steps.label).toBe("Ask me first");
    expect(steps.description).toMatch(/asks before each step/);
    expect(steps.description).toMatch(/waits for a grown-up/);
  });

  it("tells a parent risky steps still wait and the plan still comes first", () => {
    const does = familyCopy.does.join(" ");
    expect(does).toMatch(/run by themselves/);
    expect(does).toMatch(/waits for a grown-up/);
    expect(does).toMatch(/Build it/);
    expect(does).toMatch(/asked before each step/);
  });
});
