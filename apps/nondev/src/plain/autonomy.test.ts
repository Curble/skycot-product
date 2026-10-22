import { describe, expect, it } from "vite-plus/test";

import {
  AUTONOMY_LEVELS,
  DEFAULT_AUTONOMY,
  HARD_RULES,
  autoModeNote,
  autonomyToRuntimeMode,
  describeAutonomyLevel,
  describeSpeedCare,
  hardRuleTitles,
  hardRulesStatement,
  isPlainAutonomyLevel,
  plainAutonomyLevels,
  resolveAutonomyForProvider,
  runtimeModeToAutonomy,
} from "./autonomy";
import { decodeOptionDescriptor } from "./fixtures.test-helpers";

describe("autonomy levels", () => {
  it("defaults to asking first, unlike the stock full-access default", () => {
    expect(DEFAULT_AUTONOMY).toBe("askMeFirst");
    expect(autonomyToRuntimeMode("askMeFirst")).toBe("approval-required");
    expect(autonomyToRuntimeMode("justDoItCarefully")).toBe("auto-accept-edits");
    expect(autonomyToRuntimeMode("fullyHandsOff")).toBe("full-access");
  });

  it("maps every runtime mode back, folding the provider's auto reviewer into the middle", () => {
    expect(runtimeModeToAutonomy("approval-required")).toBe("askMeFirst");
    expect(runtimeModeToAutonomy("auto-accept-edits")).toBe("justDoItCarefully");
    expect(runtimeModeToAutonomy("auto")).toBe("justDoItCarefully");
    expect(runtimeModeToAutonomy("full-access")).toBe("fullyHandsOff");
  });

  it("flags hands-off as high risk with a warning that admits no rules apply", () => {
    const handsOff = AUTONOMY_LEVELS.fullyHandsOff;
    expect(handsOff.risk).toBe("high");
    expect(handsOff.warning).toMatch(/delete files|spend money/);
    expect(handsOff.warning).toMatch(/No safety rules apply/);
    expect(handsOff.hint).not.toMatch(/switches itself/i);
  });

  it("offers only the two asking levels on plain surfaces", () => {
    expect(plainAutonomyLevels().map((level) => level.level)).toEqual([
      "askMeFirst",
      "justDoItCarefully",
    ]);
    expect(isPlainAutonomyLevel("fullyHandsOff")).toBe(false);
    expect(AUTONOMY_LEVELS.fullyHandsOff).toBeDefined();
  });

  it("describes the middle level truthfully for each enforcement state", () => {
    expect(describeAutonomyLevel("justDoItCarefully")).toBe(
      "Edits happen without asking; the assistant decides when to ask before running something.",
    );
    expect(describeAutonomyLevel("justDoItCarefully", { policyEnforced: true })).toMatch(
      /checked against the hard rules/,
    );
    expect(describeAutonomyLevel("askMeFirst", { policyEnforced: true })).toBe(
      AUTONOMY_LEVELS.askMeFirst.description,
    );
  });

  it("states the hard-rules guarantee only when the server enforces it", () => {
    expect(hardRulesStatement(false)).toMatch(/not enforced/);
    expect(hardRulesStatement(false)).not.toMatch(/every mode/);
    expect(hardRulesStatement(true)).toMatch(/stops to ask when one matches/);
    expect(hardRulesStatement(true)).toMatch(/outside the assistant's safe area/);
    // QA FK-12: with the Family profile on, the child's composer names no other mode.
    for (const enforced of [true, false]) {
      const family = hardRulesStatement(enforced, "SKYCOT", true);
      expect(family).not.toMatch(/hands-off|Just do it|Advanced mode/);
      expect(family).toMatch(/parent code/);
    }
    expect(hardRuleTitles()).toContain("Stepping outside the assistant's safe area");
    expect(hardRuleTitles()).toContain("Deleting files or folders");
    expect(hardRuleTitles().length).toBe(HARD_RULES.length);
  });
});

describe("resolveAutonomyForProvider", () => {
  it("keeps the requested level when the provider supports it", () => {
    const resolved = resolveAutonomyForProvider("justDoItCarefully", { driver: "codex" });
    expect(resolved).toMatchObject({
      effective: "justDoItCarefully",
      runtimeMode: "auto-accept-edits",
      available: true,
    });
    expect(resolved.availableLevels).toEqual(["askMeFirst", "justDoItCarefully", "fullyHandsOff"]);
  });

  it("falls back towards asking, never towards hands-off, and explains why", () => {
    const muse = resolveAutonomyForProvider("justDoItCarefully", { driver: "muse" });
    expect(muse).toMatchObject({
      effective: "askMeFirst",
      runtimeMode: "approval-required",
      available: false,
      fallbackFrom: "justDoItCarefully",
    });
    expect(muse.explanation).toBe(
      'Muse doesn\'t offer "Just do it, carefully", so this conversation runs as "Ask me first" instead. That means more questions, never fewer.',
    );
    expect(muse.availableLevels).toEqual(["askMeFirst", "fullyHandsOff"]);
    const grok = resolveAutonomyForProvider("justDoItCarefully", { driver: "grok" });
    expect(grok.effective).toBe("askMeFirst");
  });

  it("prefers the live snapshot's supported modes over the static matrix", () => {
    const resolved = resolveAutonomyForProvider("justDoItCarefully", {
      driver: "muse",
      displayName: "Muse (beta)",
      supportedRuntimeModes: ["approval-required", "auto-accept-edits", "full-access"],
    });
    expect(resolved.available).toBe(true);
    const restricted = resolveAutonomyForProvider("justDoItCarefully", {
      driver: "codex",
      displayName: "Codex",
      supportedRuntimeModes: ["approval-required", "full-access"],
    });
    expect(restricted.available).toBe(false);
    expect(restricted.explanation).toMatch(/^Codex doesn't offer/);
  });

  it("treats unknown providers as supporting everything", () => {
    expect(resolveAutonomyForProvider("fullyHandsOff", { driver: "someNewDriver" }).available).toBe(
      true,
    );
    expect(resolveAutonomyForProvider("fullyHandsOff").explanation).toBe(
      AUTONOMY_LEVELS.fullyHandsOff.warning,
    );
  });

  it("notes the provider's own reviewer only where auto exists", () => {
    expect(autoModeNote({ driver: "codex" })).toMatch(/built-in reviewer/);
    expect(autoModeNote({ driver: "pi" })).toBeUndefined();
  });
});

describe("describeSpeedCare", () => {
  const effort = decodeOptionDescriptor({
    id: "reasoningEffort",
    label: "Reasoning effort",
    type: "select",
    currentValue: "medium",
    options: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium", isDefault: true },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
    ],
  });
  const tier = decodeOptionDescriptor({
    id: "serviceTier",
    label: "Service tier",
    type: "select",
    options: [
      { id: "standard", label: "Standard", isDefault: true },
      { id: "flex", label: "Flex" },
      { id: "priority", label: "Priority" },
    ],
  });
  const fastMode = decodeOptionDescriptor({
    id: "fastMode",
    label: "Fast mode",
    type: "boolean",
    currentValue: true,
  });

  it("collapses effort choices into careful / balanced / quick with real values", () => {
    const { care } = describeSpeedCare([effort]);
    expect(care?.optionId).toBe("reasoningEffort");
    expect(care?.current).toBe("balanced");
    expect(care?.choices.map((c) => [c.level, c.value, c.label])).toEqual([
      ["quick", "low", "Quick"],
      ["balanced", "medium", "Balanced"],
      ["careful", "high", "Careful"],
    ]);
    expect(care?.choices.find((c) => c.level === "careful")?.costNote).toMatch(/allowance/);
    expect(care?.advanced).toBe("Advanced: Reasoning effort (reasoningEffort)");
  });

  it("maps speed tiers and boolean fast-mode toggles", () => {
    const tiers = describeSpeedCare([tier]).speed;
    expect(tiers?.choices.map((c) => [c.level, c.value])).toEqual([
      ["normal", "standard"],
      ["fast", "flex"],
      ["fastest", "priority"],
    ]);
    expect(tiers?.choices[2]?.costNote).toBe("Costs more per request.");
    const toggle = describeSpeedCare([fastMode]).speed;
    expect(toggle?.current).toBe("fast");
    expect(toggle?.choices.map((c) => [c.level, c.value, c.isDefault])).toEqual([
      ["normal", "false", false],
      ["fast", "true", true],
    ]);
  });

  it("returns nothing when the model exposes no traits", () => {
    expect(describeSpeedCare(undefined)).toEqual({});
    expect(
      describeSpeedCare([
        decodeOptionDescriptor({ id: "webSearch", label: "Web search", type: "boolean" }),
      ]),
    ).toEqual({});
  });
});
