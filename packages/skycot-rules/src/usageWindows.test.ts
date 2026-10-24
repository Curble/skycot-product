import { describe, expect, it } from "vite-plus/test";

import {
  isSpendWindow,
  scopedModelName,
  windowLimitsModel,
  windowScopesModel,
} from "./usageWindows.ts";

const FABLE_WEEK = { id: "seven_day_fable", label: "Weekly · Fable" };
const WEEK = { id: "seven_day", label: "Weekly" };
const SESSION = { id: "five_hour", label: "Session" };
const SPEND = { id: "monthly_spend", label: "Monthly spend" };
const fable = { slug: "claude-fable-5-1", name: "Claude Fable 5.1", aliases: ["fable"] };
const sonnet = { slug: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" };

describe("which model an allowance window is about", () => {
  it("names a model's own weekly window, never an account-wide one", () => {
    expect(scopedModelName(FABLE_WEEK)).toBe("Fable");
    expect(scopedModelName(WEEK)).toBeNull();
    expect(scopedModelName(SESSION)).toBeNull();
    expect(scopedModelName(SPEND)).toBeNull();
    expect(isSpendWindow(SPEND)).toBe(true);
  });

  it("matches the model by name, slug or alias, whole words only", () => {
    expect(windowScopesModel(FABLE_WEEK, fable)).toBe(true);
    expect(windowScopesModel(FABLE_WEEK, { slug: "fable" })).toBe(true);
    expect(windowScopesModel(FABLE_WEEK, sonnet)).toBe(false);
    expect(windowScopesModel({ id: "seven_day_fab", label: "Weekly · Fab" }, fable)).toBe(false);
    expect(windowScopesModel(WEEK, fable)).toBe(false);
  });

  it("an account window limits every model; a model's own only that model; spending never", () => {
    expect(windowLimitsModel(WEEK, sonnet)).toBe(true);
    expect(windowLimitsModel(WEEK, null)).toBe(true);
    expect(windowLimitsModel(FABLE_WEEK, fable)).toBe(true);
    expect(windowLimitsModel(FABLE_WEEK, sonnet)).toBe(false);
    expect(windowLimitsModel(FABLE_WEEK, null)).toBe(false);
    expect(windowLimitsModel(SPEND, fable)).toBe(false);
  });
});
