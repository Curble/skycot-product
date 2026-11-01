// nondev-seam: skycot-policy-files
// Family lockdown for the engine's own background AI calls: a conversation's title, and the
// commit message, branch name, pull-request text and review guide a grown-up may ask for.
// They run the provider's CLI on the child's words, so they follow the same rule as the
// child's session (SkycotFamilyLockdown.ts): while the profile is on, Codex and Claude, each
// without the parent's add-ons, and any other provider only once a grown-up allowed it for the
// Family profile (then as upstream runs it).
//
// The first live check of the lockdown found the gap this closes: the child's Codex session
// started clean, but T3's title generator (`codex exec`) still ran the parent's `notify`
// program after its one turn, which started a computer-use helper. Upstream already keeps
// plugins, apps and MCP servers out of text generation; the Family lockdown adds the rest
// (notify, hooks, computer and browser use, skills, memories) for Codex, and switches hooks
// off for Claude (its text generation already runs with no tools and no MCP server).
//
// Wired at the TextGeneration layer (seam skycot-family-lockdown-text): the lockdown is put in
// context for the call, and CodexTextGeneration / ClaudeTextGeneration read it (seams
// skycot-family-lockdown-text-codex / -claude).

import { TextGenerationError } from "@t3tools/contracts";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import { withoutSpeedOptions } from "@t3tools/skycot-rules/speed";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as SkycotFamily from "./SkycotFamily.ts";
import * as SkycotFamilyLockdown from "./SkycotFamilyLockdown.ts";

type Operation = keyof ProviderTextGeneration;

/**
 * The TextGeneration service with every call under the Family lockdown while the profile is on.
 * The same service without the Family service (stock T3 Code, upstream tests).
 */
export const lockTextGeneration = Effect.fn("SkycotFamilyTextGeneration.lockTextGeneration")(
  function* <E, R>(
    make: Effect.Effect<ProviderTextGeneration, E, R>,
  ): Effect.fn.Return<
    ProviderTextGeneration,
    E,
    R | ProviderInstanceRegistry.ProviderInstanceRegistry
  > {
    const service = yield* make;
    const family = yield* Effect.serviceOption(SkycotFamily.SkycotFamily);
    if (Option.isNone(family)) return service;
    const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;

    const locked = <
      I extends {
        readonly modelSelection: {
          readonly instanceId: string;
          readonly options?: ReadonlyArray<{ readonly id: string; readonly value: unknown }>;
        };
      },
      A,
    >(
      operation: Operation,
      run: (input: I) => Effect.Effect<A, TextGenerationError>,
    ) =>
      Effect.fn(`SkycotFamilyTextGeneration.${operation}`)(function* (input: I) {
        if (!(yield* family.value.isEnabled)) return yield* run(input);
        const instance = yield* registry.getInstance(
          input.modelSelection.instanceId as Parameters<typeof registry.getInstance>[0],
        );
        const driver = instance?.driverKind;
        if (
          driver !== undefined &&
          (yield* SkycotFamilyLockdown.allowedUnlocked(family.value, driver))
        ) {
          return yield* run(input);
        }
        if (driver === undefined || !SkycotFamilyLockdown.LOCKED_DOWN_DRIVERS.has(driver)) {
          return yield* new TextGenerationError({
            operation,
            detail: SkycotFamilyLockdown.familyLockdownSentence(
              driver ?? "unknown",
              "unsupported-provider",
            ),
          });
        }
        // A faster tier costs more of the plan: background calls run at normal speed too.
        const options = withoutSpeedOptions(input.modelSelection.options);
        const held =
          options === input.modelSelection.options
            ? input
            : {
                ...input,
                modelSelection: (({ options: _dropped, ...rest }) =>
                  options === undefined ? rest : { ...rest, options })(input.modelSelection),
              };
        return yield* run(held).pipe(
          Effect.provideService(
            SkycotFamilyLockdown.FamilyLockdownRef,
            new SkycotFamilyLockdown.FamilyLockdown(driver),
          ),
        );
      });

    return {
      generateCommitMessage: locked("generateCommitMessage", service.generateCommitMessage),
      generatePrContent: locked("generatePrContent", service.generatePrContent),
      generateBranchName: locked("generateBranchName", service.generateBranchName),
      generateThreadTitle: locked("generateThreadTitle", service.generateThreadTitle),
      generateReviewGuide: locked("generateReviewGuide", service.generateReviewGuide),
    };
  },
);
