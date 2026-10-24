// nondev-seam: skycot-policy-files
// The one judge, used before a turn starts and when a limit stops a turn half-way: is the model
// the turn asked for usable? If not, the best usable model of the same provider; if none, the
// best usable model of another provider the family is signed in to and may use; if nothing is
// usable, nothing changes and the engine waits for the reset as it always has.

import type { ServerProvider } from "@t3tools/contracts";

import {
  availabilityOf,
  modelKey,
  sameModel,
  type LearnedLimit,
  type ModelRef,
} from "./availability.ts";
import { otherReadyProviders, rankModels } from "./ranking.ts";

export interface ChoiceInput {
  readonly requested: ModelRef;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly learned: ReadonlyArray<LearnedLimit>;
  readonly now: number;
  /** Models this turn already ran on (`modelKey`): each is tried at most once per turn. */
  readonly tried?: ReadonlySet<string>;
  /**
   * Providers a turn may be moved to: the Family profile's allowed assistants, and not one whose
   * allowance is down to the child's "keep for the grown-ups" line. The requested provider is
   * the one the person is already using, so it is not asked.
   */
  readonly mayMoveTo?: (provider: ServerProvider) => boolean;
}

export type Choice =
  /** The requested model can run (or nothing is known against it). */
  | { readonly type: "keep" }
  | {
      readonly type: "switch";
      readonly from: ModelRef;
      readonly to: ModelRef;
      /** When the requested model comes back (epoch ms), when known. */
      readonly until: number | null;
      /** Moved to another provider, not just another model of the same one. */
      readonly crossProvider: boolean;
    }
  /** Nothing usable: leave the turn as it is (the engine waits for the reset). */
  | { readonly type: "wait"; readonly until: number | null };

export function chooseModel(input: ChoiceInput): Choice {
  const { requested, providers, learned, now } = input;
  const tried = input.tried ?? new Set<string>();
  const home = providers.find((provider) => String(provider.instanceId) === requested.instanceId);
  if (home === undefined) return { type: "keep" };
  const wanted = availabilityOf(home, requested.model, learned, now);
  if (wanted.usable && !tried.has(modelKey(requested))) return { type: "keep" };

  const pick = (provider: ServerProvider, skipRequested: boolean): ModelRef | null => {
    for (const model of rankModels(provider)) {
      const ref = { instanceId: String(provider.instanceId), model: model.slug };
      if (skipRequested && sameModel(provider, model.slug, requested.model)) continue;
      if (tried.has(modelKey(ref))) continue;
      if (availabilityOf(provider, model.slug, learned, now).usable) return ref;
    }
    return null;
  };

  const sameProvider = wanted.scope === "account" ? null : pick(home, true);
  if (sameProvider !== null) {
    return {
      type: "switch",
      from: requested,
      to: sameProvider,
      until: wanted.until,
      crossProvider: false,
    };
  }
  for (const provider of otherReadyProviders(providers, requested.instanceId)) {
    if (input.mayMoveTo !== undefined && !input.mayMoveTo(provider)) continue;
    const other = pick(provider, false);
    if (other !== null) {
      return {
        type: "switch",
        from: requested,
        to: other,
        until: wanted.until,
        crossProvider: true,
      };
    }
  }
  return { type: "wait", until: wanted.until };
}
