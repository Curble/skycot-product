import { ModelSelection } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { decodeOptionDescriptor } from "../../plain/fixtures.test-helpers";
import {
  parseSpeedChoices,
  selectionWithSpeed,
  shownSpeed,
  speedCosts,
  speedModelFor,
  withSpeedChoice,
} from "./speedChoice";

const tiers = decodeOptionDescriptor({
  id: "serviceTier",
  label: "Service Tier",
  type: "select",
  currentValue: "standard",
  options: [
    { id: "standard", label: "Standard", isDefault: true },
    { id: "fast", label: "Fast" },
    { id: "ultrafast", label: "Ultrafast" },
  ],
});
const toggle = decodeOptionDescriptor({ id: "fastMode", label: "Fast Mode", type: "boolean" });
const grownUp = { childView: false, familyOn: false };
const decode = Schema.decodeUnknownSync(ModelSelection);
const selection = decode({
  instanceId: "codex",
  model: "gpt-5-codex",
  options: [{ id: "reasoningEffort", value: "high" }],
});

describe("speed boost control", () => {
  it("exists only when the assistant offers a speed option", () => {
    expect(speedModelFor([tiers], grownUp)).not.toBeNull();
    expect(speedModelFor([toggle], grownUp)).not.toBeNull();
    expect(speedModelFor(undefined, grownUp)).toBeNull();
    expect(speedModelFor([], grownUp)).toBeNull();
  });

  it("offers a third stop only when the assistant has a third tier", () => {
    expect(speedModelFor([tiers], grownUp)!.speed.choices.map((c) => c.level)).toEqual([
      "normal",
      "fast",
      "fastest",
    ]);
    expect(speedModelFor([toggle], grownUp)!.speed.choices.map((c) => c.level)).toEqual([
      "normal",
      "fast",
    ]);
  });

  it("is hidden for a child and while the Family profile is on", () => {
    expect(speedModelFor([tiers], { childView: true, familyOn: true })).toBeNull();
    expect(speedModelFor([tiers], { childView: true, familyOn: false })).toBeNull();
    expect(speedModelFor([tiers], { childView: false, familyOn: true })).toBeNull();
  });

  it("says the faster stops cost more, and normal says nothing", () => {
    expect(speedCosts.normal).toBeUndefined();
    expect(speedCosts.fast).toMatch(/more of your plan/);
    expect(speedCosts.fastest).toMatch(/plan/);
  });

  it("starts at the usual setting and sends nothing extra there", () => {
    const model = speedModelFor([tiers], grownUp)!;
    expect(model.usual).toBe("normal");
    expect(shownSpeed(model, undefined)).toBe("normal");
    expect(selectionWithSpeed(selection, model, undefined)).toBe(selection);
    expect(selectionWithSpeed(selection, model, "normal")).toBe(selection);
  });

  it("sends the chosen tier and keeps the other options", () => {
    const model = speedModelFor([tiers], grownUp)!;
    expect(selectionWithSpeed(selection, model, "fast").options).toEqual([
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "fast" },
    ]);
    expect(selectionWithSpeed(selection, model, "fastest").options).toEqual([
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "ultrafast" },
    ]);
  });

  it("sends a real true for an on/off option and replaces an old speed", () => {
    const model = speedModelFor([toggle], grownUp)!;
    const had = decode({
      instanceId: "claude",
      model: "opus",
      options: [{ id: "fastMode", value: false }],
    });
    expect(selectionWithSpeed(had, model, "fast").options).toEqual([
      { id: "fastMode", value: true },
    ]);
  });

  it("sends nothing when there is no control", () => {
    expect(selectionWithSpeed(selection, null, "fast")).toBe(selection);
  });

  it("remembers a pick per conversation and forgets it on the usual setting", () => {
    let choices = withSpeedChoice({}, "t1", "fast", "normal");
    expect(choices).toEqual({ t1: "fast" });
    choices = withSpeedChoice(choices, "t2", "fastest", "normal");
    choices = withSpeedChoice(choices, "t1", "normal", "normal");
    expect(choices).toEqual({ t2: "fastest" });
    expect(parseSpeedChoices(JSON.stringify({ a: "fast", b: "nonsense" }))).toEqual({ a: "fast" });
    expect(parseSpeedChoices("not json")).toEqual({});
    expect(parseSpeedChoices(null)).toEqual({});
  });

  it("ignores a remembered stop the model no longer has", () => {
    const three = speedModelFor([tiers], grownUp)!;
    const two = speedModelFor([toggle], grownUp)!;
    expect(shownSpeed(three, "fastest")).toBe("fastest");
    expect(shownSpeed(two, "fastest")).toBe("normal");
  });
});
