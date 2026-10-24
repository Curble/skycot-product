// nondev-seam: skycot-rules-package
// Which model an allowance window is about. Claude has an account-wide allowance (the 5-hour and
// 7-day windows) and, for some models, a weekly allowance of their own: the engine names that
// window "Weekly · Fable" (id `seven_day_fable`), from the model's display name Claude reports.
// When the model's own window runs out, that model stops while the rest of the account still
// works, so the engine (choosing a model for a turn) and the plain client (the allowance ring
// and banner) must both know which model such a window belongs to. One rule, here, so the
// two never disagree.

/** The window fields this reads (the engine's ServerProviderUsageWindow has them all). */
export interface UsageWindowLike {
  readonly id: string;
  readonly label: string;
}

/** The model fields this reads (the engine's ServerProviderModel has them all). */
export interface ModelLike {
  readonly slug: string;
  readonly name?: string | undefined;
  readonly shortName?: string | undefined;
  readonly aliases?: ReadonlyArray<string> | undefined;
}

/** A spending cap, not an allowance: it never decides whether a model can run. */
export function isSpendWindow(window: Pick<UsageWindowLike, "id">): boolean {
  return window.id === "monthly_spend";
}

/**
 * The model a window belongs to ("Fable", "Opus"), or null for an account-wide window. Only a
 * weekly window with a name after "·" is a model's own (the engine's account-wide windows are
 * plain "Session" and "Weekly").
 */
export function scopedModelName(window: UsageWindowLike): string | null {
  if (!window.id.startsWith("seven_day_") || isSpendWindow(window)) return null;
  const named = /·\s*(.+)$/.exec(window.label)?.[1]?.trim();
  return named !== undefined && named.length > 0 ? named : null;
}

const words = (text: string): ReadonlyArray<string> =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);

/**
 * Whether a model-only window ("Weekly · Fable") is this model's: every word of the window's
 * model name appears in the model's name, slug or aliases ("Claude Fable 5.1", `claude-fable-5-1`).
 * An account-wide window is no single model's.
 */
export function windowScopesModel(window: UsageWindowLike, model: ModelLike): boolean {
  const name = scopedModelName(window);
  if (name === null) return false;
  const wanted = words(name);
  if (wanted.length === 0) return false;
  const have = new Set(
    [model.slug, model.name ?? "", model.shortName ?? "", ...(model.aliases ?? [])].flatMap(words),
  );
  return wanted.every((word) => have.has(word));
}

/**
 * Whether a window can stop this model: every account-wide allowance, and the model's own;
 * never another model's own window, and never a spending cap.
 */
export function windowLimitsModel(window: UsageWindowLike, model: ModelLike | null): boolean {
  if (isSpendWindow(window)) return false;
  if (scopedModelName(window) === null) return true;
  return model !== null && windowScopesModel(window, model);
}
