// The facts the Family rules need beyond a conversation's folders (family.ts `FamilyContext`),
// read the same way by the policy reactor (which may answer a step by itself) and the gate
// (which decides whether a child's own yes counts), so the two can never disagree:
//   - whether SKYCOT itself does an accepted add-on install or download here (Codex only:
//     SkycotApprovedInstalls), so the assistant's own command never runs;
//   - the parent's "Trusted add-ons download by themselves";
//   - the add-ons a grown-up already allowed in this conversation (SkycotAddOnApprovals);
//   - whether the conversation keeps versions (a restore point is ready), so a delete inside
//     the project can be undone.
// Anything that cannot be read is the strict answer: no relief, a grown-up as before.

import type { ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import type { FamilyContext } from "@t3tools/skycot-rules/family";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { ADD_ON_FILE_NAME, approvedAddOnsFor, readAddOnFile } from "./SkycotAddOnApprovals.ts";
import * as SkycotFamily from "./SkycotFamily.ts";

export type FamilyExtras = Pick<
  FamilyContext,
  "skycotFetchesAddOns" | "trustedAddOns" | "approvedAddOns" | "keepsVersions"
>;

export type FamilyExtrasFor = (input: {
  readonly threadId: ThreadId;
  readonly driver: ProviderDriverKind | string | undefined;
}) => Effect.Effect<FamilyExtras>;

/** Where SKYCOT keeps its add-on memory, when the engine has a home; null otherwise. */
export const addOnFilePathOption = Effect.gen(function* () {
  const config = yield* Effect.serviceOption(ServerConfig.ServerConfig);
  const path = yield* Effect.serviceOption(Path.Path);
  return Option.isSome(config) && Option.isSome(path)
    ? path.value.join(config.value.stateDir, ADD_ON_FILE_NAME)
    : null;
});

export const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const family = yield* Effect.serviceOption(SkycotFamily.SkycotFamily);
  const fs = yield* Effect.serviceOption(FileSystem.FileSystem);
  const filePath = Option.isSome(fs) ? yield* addOnFilePathOption : null;

  const extrasFor: FamilyExtrasFor = Effect.fn("SkycotFamilyExtras.extrasFor")(function* ({
    threadId,
    driver,
  }) {
    const skycotFetchesAddOns = driver === "codex";
    const trustedAddOns = Option.isNone(family)
      ? false
      : yield* family.value.trustedAddOnsOn.pipe(Effect.catchCause(() => Effect.succeed(false)));
    const approvedAddOns =
      filePath === null || Option.isNone(fs)
        ? []
        : approvedAddOnsFor(
            yield* readAddOnFile(filePath).pipe(
              Effect.provideService(FileSystem.FileSystem, fs.value),
              Effect.catchCause(() => Effect.succeed({ approvals: {} })),
            ),
            threadId,
            yield* Clock.currentTimeMillis,
          );
    const keepsVersions = yield* projections.getThreadRecords(threadId, ["checkpoints"]).pipe(
      Effect.map((records) =>
        (
          (records as { readonly checkpoints?: ReadonlyArray<{ readonly status: string }> })
            .checkpoints ?? []
        ).some((checkpoint) => checkpoint.status === "ready"),
      ),
      Effect.catchCause(() => Effect.succeed(false)),
    );
    return { skycotFetchesAddOns, trustedAddOns, approvedAddOns, keepsVersions };
  });
  return extrasFor;
});
