import { ModelSelection } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { decodeOptionDescriptor } from "../../plain/fixtures.test-helpers";
import {
  depthModelFor,
  parseDepthChoices,
  selectionWithDepth,
  shownDepth,
  withDepthChoice,
} from "./depthChoice";

const effort = decodeOptionDescriptor({
  id: "reasoningEffort",
  label: "Reasoning effort",
  type: "select",
  currentValue: "medium",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
  ],
});
const grownUp = { childView: false, familyOn: false };
const decode = Schema.decodeUnknownSync(ModelSelection);
const selection = decode({
  instanceId: "codex",
  model: "gpt-5-codex",
  options: [{ id: "fastMode", value: true }],
});

describe("thinking depth control", () => {
  it("exists only when the assistant offers an effort option", () => {
    expect(depthModelFor([effort], grownUp)).not.toBeNull();
    expect(depthModelFor(undefined, grownUp)).toBeNull();
    expect(depthModelFor([], grownUp)).toBeNull();
    const oneStop = decodeOptionDescriptor({
      id: "reasoningEffort",
      label: "Effort",
      type: "select",
      options: [{ id: "medium", label: "Medium", isDefault: true }],
    });
    expect(depthModelFor([oneStop], grownUp)).toBeNull();
  });

  it("is hidden for a child and while the Family profile is on", () => {
    expect(depthModelFor([effort], { childView: true, familyOn: true })).toBeNull();
    expect(depthModelFor([effort], { childView: true, familyOn: false })).toBeNull();
    expect(depthModelFor([effort], { childView: false, familyOn: true })).toBeNull();
  });

  it("starts at the usual setting and sends nothing extra there", () => {
    const model = depthModelFor([effort], grownUp)!;
    expect(model.usual).toBe("balanced");
    expect(shownDepth(model, undefined)).toBe("balanced");
    expect(selectionWithDepth(selection, model, undefined)).toBe(selection);
    expect(selectionWithDepth(selection, model, "balanced")).toBe(selection);
  });

  it("sends the chosen value in the model selection and keeps the other options", () => {
    const model = depthModelFor([effort], grownUp)!;
    expect(selectionWithDepth(selection, model, "careful").options).toEqual([
      { id: "fastMode", value: true },
      { id: "reasoningEffort", value: "high" },
    ]);
    expect(selectionWithDepth(selection, model, "quick").options).toEqual([
      { id: "fastMode", value: true },
      { id: "reasoningEffort", value: "low" },
    ]);
  });

  it("replaces an effort the selection already carried", () => {
    const model = depthModelFor([effort], grownUp)!;
    const had = decode({
      instanceId: "codex",
      model: "gpt-5-codex",
      options: [{ id: "reasoningEffort", value: "low" }],
    });
    expect(selectionWithDepth(had, model, "careful").options).toEqual([
      { id: "reasoningEffort", value: "high" },
    ]);
  });

  it("sends nothing when there is no control", () => {
    expect(selectionWithDepth(selection, null, "careful")).toBe(selection);
  });

  it("remembers a pick per conversation and forgets it on the usual setting", () => {
    let choices = withDepthChoice({}, "t1", "careful", "balanced");
    expect(choices).toEqual({ t1: "careful" });
    choices = withDepthChoice(choices, "t2", "quick", "balanced");
    choices = withDepthChoice(choices, "t1", "balanced", "balanced");
    expect(choices).toEqual({ t2: "quick" });
    expect(parseDepthChoices(JSON.stringify({ a: "careful", b: "nonsense" }))).toEqual({
      a: "careful",
    });
    expect(parseDepthChoices("not json")).toEqual({});
    expect(parseDepthChoices(null)).toEqual({});
  });

  it("ignores a remembered stop the model no longer has", () => {
    const model = depthModelFor([effort], grownUp)!;
    const twoStops = depthModelFor(
      [
        decodeOptionDescriptor({
          id: "reasoningEffort",
          label: "Effort",
          type: "select",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium", isDefault: true },
          ],
        }),
      ],
      grownUp,
    )!;
    expect(shownDepth(model, "careful")).toBe("careful");
    expect(shownDepth(twoStops, "careful")).toBe("balanced");
  });
});
