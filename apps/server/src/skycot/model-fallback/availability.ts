// nondev-seam: skycot-policy-files
// Whether an assistant model can run right now, and if not, when it comes back. Pure: it reads
// the provider snapshots the engine already keeps (ServerProvider.usageLimits, refreshed by each
// provider's usage probe and by the rate-limit updates turns report) and what usage-limit
// failures taught us (`LearnedLimit`), and never asks a provider anything itself.
//
// The rule: a window at 100% or more is exhausted until its `resetsAt`; an account-wide window
// stops every model of that provider, a model's own window ("Weekly · Fable", see
// `@t3tools/skycot-rules/usageWindows`) stops that model only. A fresh usage-limit failure counts
// the same until its reset time. Anything unknown (no report, no reset time) is usable: the
// fallback only ever moves a turn away from a limit the engine actually saw.

import type { ServerProvider, ServerProviderModel } from "@t3tools/contracts";
import {
  isSpendWindow,
  scopedModelName,
  windowScopesModel,
} from "@t3tools/skycot-rules/usageWindows";

/** One model of one provider instance, as a turn names it. */
export interface ModelRef {
  readonly instanceId: string;
  readonly model: string;
}

export const modelKey = (ref: ModelRef): string => `${ref.instanceId}\u0000${ref.model}`;

/** What a usage-limit failure taught: this model (or, with `model` null, the whole account) is out until `until`. */
export interface LearnedLimit {
  readonly instanceId: string;
  readonly model: string | null;
  readonly until: number;
}

export interface Availability {
  readonly usable: boolean;
  /** When it can run again (epoch ms); null when usable, or when no reset time is known. */
  readonly until: number | null;
  /** What ran out: the model's own allowance, or the whole account's. */
  readonly scope: "model" | "account" | null;
}

const USABLE: Availability = { usable: true, until: null, scope: null };

/** The provider's model for a slug or one of its aliases ("fable" → `claude-fable-5-1`). */
export function findModel(
  provider: Pick<ServerProvider, "models">,
  slugOrAlias: string,
): ServerProviderModel | undefined {
  const wanted = slugOrAlias.trim().toLowerCase();
  return (
    provider.models.find((model) => model.slug.toLowerCase() === wanted) ??
    provider.models.find((model) => model.aliases?.some((alias) => alias.toLowerCase() === wanted))
  );
}

/** The same model, whether named by slug or alias. */
export function sameModel(
  provider: Pick<ServerProvider, "models">,
  left: string,
  right: string,
): boolean {
  if (left === right) return true;
  const a = findModel(provider, left);
  return a !== undefined && a.slug === findModel(provider, right)?.slug;
}

/**
 * Installed, switched on and signed in: an assistant the family already set up. Only these are
 * ever chosen for a turn the person did not point at them.
 */
export function isReadyProvider(provider: ServerProvider): boolean {
  return (
    provider.enabled &&
    provider.installed &&
    provider.availability !== "unavailable" &&
    provider.auth.status === "authenticated" &&
    (provider.status === "ready" || provider.status === "warning")
  );
}

const later = (left: number | null, right: number): number =>
  left === null || right > left ? right : left;

export function availabilityOf(
  provider: ServerProvider,
  model: string,
  learned: ReadonlyArray<LearnedLimit>,
  now: number,
): Availability {
  let accountUntil: number | null = null;
  let modelUntil: number | null = null;
  const limits = provider.usageLimits;
  const info = findModel(provider, model) ?? { slug: model };
  if (
    limits !== undefined &&
    limits.unavailable === undefined &&
    provider.auth.status !== "unauthenticated"
  ) {
    for (const window of limits.windows) {
      if (isSpendWindow(window) || window.usedPercent < 100 || window.resetsAt === undefined) {
        continue;
      }
      const resetsAt = Date.parse(window.resetsAt);
      if (!Number.isFinite(resetsAt) || resetsAt <= now) continue;
      if (scopedModelName(window) === null) accountUntil = later(accountUntil, resetsAt);
      else if (windowScopesModel(window, info)) modelUntil = later(modelUntil, resetsAt);
    }
  }
  for (const entry of learned) {
    if (entry.instanceId !== String(provider.instanceId) || entry.until <= now) continue;
    if (entry.model === null) accountUntil = later(accountUntil, entry.until);
    else if (sameModel(provider, entry.model, model)) modelUntil = later(modelUntil, entry.until);
  }
  if (accountUntil !== null) {
    return {
      usable: false,
      until: modelUntil === null ? accountUntil : Math.max(accountUntil, modelUntil),
      scope: "account",
    };
  }
  if (modelUntil !== null) return { usable: false, until: modelUntil, scope: "model" };
  return USABLE;
}

/** Reset times this close together are the same window reported twice. */
const SAME_RESET_MS = 2 * 60_000;

/**
 * What a usage-limit failure with this reset time stopped: the whole account only when an
 * account-wide window that resets at that time is spent (its reset time matches the failure's,
 * both come from the same rate-limit report). Anything else is taken as the model's own
 * allowance, the narrowest reading, so the rest of the account is still tried once: Claude's
 * account week and a model's own week can reset at the same moment, and an unspent account
 * window must not send the child to another company.
 */
export function failureScope(
  provider: ServerProvider,
  resetAt: number | null,
): "model" | "account" {
  if (resetAt === null) return "model";
  for (const window of provider.usageLimits?.windows ?? []) {
    if (isSpendWindow(window) || window.resetsAt === undefined || window.usedPercent < 100) {
      continue;
    }
    if (scopedModelName(window) !== null) continue;
    const resetsAt = Date.parse(window.resetsAt);
    if (Number.isFinite(resetsAt) && Math.abs(resetsAt - resetAt) <= SAME_RESET_MS) {
      return "account";
    }
  }
  return "model";
}

/** Two failures of one provider within a turn, with the same reset time: the account is out. */
export function sameReset(left: number | null, right: number | null): boolean {
  return left !== null && right !== null && Math.abs(left - right) <= SAME_RESET_MS;
}
