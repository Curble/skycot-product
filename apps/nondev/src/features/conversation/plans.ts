/** A later live plan replaces the earlier card before the projection catches up. */
export function replacedByNewerPlan(
  item: { readonly ordinal: number; readonly planId: string },
  items: ReadonlyArray<{
    readonly type: string;
    readonly ordinal: number;
    readonly planId?: string | undefined;
  }>,
  plans: ReadonlyArray<{ readonly id: string; readonly kind: string; readonly status: string }>,
): boolean {
  const activeIds = new Set(
    plans
      .filter((plan) => plan.kind === "proposed_plan" && plan.status === "active")
      .map((plan) => plan.id),
  );
  return items.some(
    (candidate) =>
      candidate.type === "proposed_plan" &&
      candidate.ordinal > item.ordinal &&
      candidate.planId !== undefined &&
      activeIds.has(candidate.planId),
  );
}
