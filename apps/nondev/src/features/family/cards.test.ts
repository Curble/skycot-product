import { describe, expect, it } from "vite-plus/test";

import { describeRuntimeRequest } from "../../plain/approvals";
import { items } from "../../plain/fixtures.test-helpers";
import {
  familyCard,
  familyHoldFor,
  isFamilyRefusal,
  toolItemTypeFor,
  waitsForEngineCheck,
} from "./cards";
import { familyCopy } from "./copy";

const ROOT = "/Users/kid/projects/space-game";

const allowLabels = (card: ReturnType<typeof familyCard>) => card.options.map((o) => o.label);

describe("family approval cards", () => {
  it("lets the child allow ordinary work, without any 'always' choice", () => {
    const item = items.approval("command", { prompt: "npm run build" });
    const grownUp = familyHoldFor(item, { projectRoot: ROOT });
    expect(grownUp).toBeNull();
    const card = familyCard(describeRuntimeRequest(item, { projectRoot: ROOT }), grownUp);
    expect(card.grownUp).toBeNull();
    for (const option of card.options) {
      if (option.decision.type === "runtime-request.respond" && "decision" in option.decision) {
        expect(["acceptForSession", "acceptAlways"]).not.toContain(option.decision.decision);
      }
    }
    expect(allowLabels(card)).not.toContain(familyCopy.askGrownUp);
  });

  it("says 'Ask a grown-up' for the internet, installs and deleting", () => {
    for (const prompt of [
      "npm install react-datepicker",
      "curl https://x.test",
      "rm -rf sprites",
    ]) {
      const item = items.approval("command", { prompt });
      const grownUp = familyHoldFor(item, { projectRoot: ROOT });
      expect(grownUp, prompt).not.toBeNull();
      const card = familyCard(describeRuntimeRequest(item, { projectRoot: ROOT }), grownUp);
      expect(allowLabels(card), prompt).toContain(familyCopy.askGrownUp);
    }
    expect(
      familyHoldFor(items.approval("command", { prompt: "npm install three" }), {
        projectRoot: ROOT,
      }),
    ).toMatch(/internet/);
  });

  it("treats a web search tool call as the internet", () => {
    const item = items.approval("command", { prompt: "Look up dinosaurs" });
    expect(familyHoldFor(item, { projectRoot: ROOT, toolItemType: "web_search" })).toMatch(
      /internet/,
    );
  });

  it("finds the tool call's type beside the approval", () => {
    const ref = { driver: "claudeAgent", nativeId: "tool-9", strength: "strong" } as const;
    const approval = items.approval("command", { prompt: "x" }, { nativeItemRef: ref as never });
    const call = {
      ...items.command("curl x", {}, { nativeItemRef: ref as never }),
      type: "web_search",
    };
    expect(toolItemTypeFor(approval, [approval, call as never])).toBe("web_search");
    expect(toolItemTypeFor(approval, [approval])).toBeUndefined();
  });

  it("recognises the engine's refusal sentence", () => {
    expect(
      isFamilyRefusal(
        "The Family profile is on, so a grown-up needs to enter the parent code first.",
      ),
    ).toBe(true);
    expect(isFamilyRefusal("That didn't go through.")).toBe(false);
    expect(isFamilyRefusal(null)).toBe(false);
  });
});

describe("a safe step the engine answers itself (Family)", () => {
  const base = {
    familyOn: true,
    isApproval: true,
    decided: false,
    needsGrownUp: false,
    askEachStep: false,
    grownUpDevice: false,
  };
  it("shows a quiet line instead of a card only for a pending safe step", () => {
    expect(waitsForEngineCheck(base)).toBe(true);
    expect(waitsForEngineCheck({ ...base, needsGrownUp: true })).toBe(false);
    expect(waitsForEngineCheck({ ...base, askEachStep: true })).toBe(false);
    expect(waitsForEngineCheck({ ...base, decided: true })).toBe(false);
    expect(waitsForEngineCheck({ ...base, grownUpDevice: true })).toBe(false);
    expect(waitsForEngineCheck({ ...base, isApproval: false })).toBe(false);
    expect(waitsForEngineCheck({ ...base, familyOn: false })).toBe(false);
  });
});
