// The grown-up recap, engine side: reads the conversations the engine knows a child started
// (the Family activity file) and hands them to the pure `buildRecap`. Computed here, not in
// the browser, because half of it only the engine has (past days' minutes, held steps judged
// by the Family rules, what the shield caught) and because it is behind the parent code: the
// route answers only after a grown-up's "yes".
import type { ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as SkycotFamilyLimits from "../family-limits/SkycotFamilyLimits.ts";
import * as SkycotFamilyGate from "../SkycotFamilyGate.ts";
import { buildRecap, rangeStart, type RecapRange, type RecapReport } from "./recap.ts";
import { loadThread } from "./threads.ts";
import * as SkycotQuestions from "../questions/SkycotQuestions.ts";

export class SkycotFamilyRecap extends Context.Service<
  SkycotFamilyRecap,
  {
    /** Null while the profile is off or when the child is not in it. */
    readonly recap: (input: {
      readonly childId: string;
      readonly range: RecapRange;
    }) => Effect.Effect<RecapReport | null>;
  }
>()("t3/skycot/family-recap/SkycotFamilyRecap") {}

const make = Effect.gen(function* () {
  const limits = yield* SkycotFamilyLimits.SkycotFamilyLimits;
  const gate = yield* SkycotFamilyGate.SkycotFamilyGate;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const questionsRoot = yield* SkycotQuestions.questionsRootOption;

  const recap: SkycotFamilyRecap["Service"]["recap"] = Effect.fn("SkycotFamilyRecap.recap")(
    function* (input) {
      const snapshot = yield* limits.snapshot;
      if (snapshot === null) return null;
      if (!snapshot.profile.children.some((child) => child.id === input.childId)) return null;
      const now = yield* Clock.currentTimeMillis;
      const timeZone = snapshot.profile.timeZone;
      const from = rangeStart(input.range, now, timeZone);
      const threads = [];
      for (const [threadId, childId] of Object.entries(snapshot.activity.threads)) {
        if (childId !== input.childId) continue;
        const loaded = yield* loadThread(projections, projects, threadId as ThreadId, {
          messages: true,
          questionsRoot,
        });
        // Nothing happened in it since the range began: no need to judge its cards.
        if (loaded === null || loaded.deleted || loaded.updatedAt < from) continue;
        const heldAt: Array<number> = [];
        for (const approval of loaded.approvals) {
          if (approval.at < from) continue;
          const needs = yield* gate.requestNeedsGrownUp({
            threadId: loaded.threadId,
            requestId: approval.requestId,
          });
          if (needs) heldAt.push(approval.at);
        }
        threads.push({ ...loaded, heldAt });
      }
      return buildRecap({
        childId: input.childId,
        range: input.range,
        now,
        timeZone,
        activity: snapshot.activity,
        threads,
      });
    },
  );

  return SkycotFamilyRecap.of({ recap });
});

export const layer = Layer.effect(SkycotFamilyRecap, make);
