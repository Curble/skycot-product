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
    return !projection.runs.some(
      (run) => run.sourcePlanRef?.planId === planId && run.status !== "rolled_back",
    );
  });
}
