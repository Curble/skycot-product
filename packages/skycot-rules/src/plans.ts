// nondev-seam: skycot-rules-package
// One rule for "is a plan really waiting for Build it": the engine's thread list (server) and
// the conversation header (client) both evaluate this file, so they can never disagree.
/**
 * A later plan in the same conversation replaces the earlier card for good, whatever became of
 * the later one (waiting, being built, built). The earlier card never offers Build it again:
 * only the newest plan can be built. A later plan whose turn was taken back does not count.
 */
export function replacedByNewerPlan(
  item: { readonly ordinal: number; readonly planId: string },
  items: ReadonlyArray<{
    readonly type: string;
    readonly ordinal: number;
    readonly planId?: string | undefined;
  }>,
  plans: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly status: string;
    readonly runId?: string | null | undefined;
  }>,
  runs: ReadonlyArray<{ readonly id: string; readonly status: string }> = [],
): boolean {
  const laterIds = new Set(
    plans
      .filter(
        (plan) =>
          plan.kind === "proposed_plan" &&
          plan.id !== item.planId &&
          !runs.some((run) => run.id === plan.runId && run.status === "rolled_back"),
      )
      .map((plan) => plan.id),
  );
  return items.some(
    (candidate) =>
      candidate.type === "proposed_plan" &&
      candidate.ordinal > item.ordinal &&
      candidate.planId !== undefined &&
      laterIds.has(candidate.planId),
  );
}

/** Projection timestamps arrive as DateTime.Utc (has epochMilliseconds); accept ISO strings too. */
type Time = { readonly epochMilliseconds: number } | string | null | undefined;

function millis(value: Time): number {
  if (value === null || value === undefined) return NaN;
  return typeof value === "string" ? Date.parse(value) : value.epochMilliseconds;
}

type BuildRun = {
  readonly id: string;
  readonly status: string;
  readonly startedAt?: Time;
  readonly sourcePlanRef?: { readonly planId: string } | undefined;
};

/**
 * The turn that built a plan, if one did (a taken-back build does not count). A build that
 * began after the plan was written built it too, even when its Build it was pressed on an
 * older card as this plan arrived: the assistant works from the newest plan it has. Without
 * this, that plan kept its buttons, and the header said "Plan ready", after it was built.
 */
export function builtBy<Run extends BuildRun>(
  plan: { readonly planId: string; readonly writtenAt?: Time },
  runs: ReadonlyArray<Run>,
): Run | undefined {
  const written = millis(plan.writtenAt);
  return runs.find((run) => {
    if (run.sourcePlanRef === undefined || run.status === "rolled_back") return false;
    if (run.sourcePlanRef.planId === plan.planId) return true;
    const began = millis(run.startedAt);
    return !Number.isNaN(written) && !Number.isNaN(began) && began >= written;
  });
}

/**
 * Whether a plan is really waiting for Build it: the newest plan, still active, its turn still
 * standing, and no turn has built it. The header reads this instead of trusting the engine's
 * "some plan is active" flag, which stays on for an older plan after a newer one is built.
 */
export function planWaitingForBuild(projection: {
  readonly turnItems: ReadonlyArray<{
    readonly type: string;
    readonly ordinal: number;
    readonly planId?: string | undefined;
    readonly completedAt?: Time;
    readonly updatedAt?: Time;
  }>;
  readonly plans: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly status: string;
    readonly runId?: string | null | undefined;
  }>;
  readonly runs: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
    readonly startedAt?: Time;
    readonly sourcePlanRef?: { readonly planId: string } | undefined;
  }>;
}): boolean {
  return projection.turnItems.some((item) => {
    if (item.type !== "proposed_plan" || item.planId === undefined) return false;
    const planId = item.planId;
    const plan = projection.plans.find((candidate) => candidate.id === planId);
    if (plan === undefined || plan.kind !== "proposed_plan" || plan.status !== "active") {
      return false;
    }
    if (
      replacedByNewerPlan(
        { ordinal: item.ordinal, planId },
        projection.turnItems,
        projection.plans,
        projection.runs,
      )
    ) {
      return false;
    }
    if (projection.runs.some((run) => run.id === plan.runId && run.status === "rolled_back")) {
      return false;
    }
    return (
      builtBy({ planId, writtenAt: item.completedAt ?? item.updatedAt }, projection.runs) ===
      undefined
    );
  });
}
