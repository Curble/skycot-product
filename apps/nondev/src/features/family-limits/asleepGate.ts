// Whether "SKYCOT is asleep" covers the window. Kept pure so the decision can be tested.
import type { LimitState, SessionLimits } from "./limits";

/**
 * The limits that put the asleep screen up, or null when it stays down. The engine's last word
 * only counts when it is about the child on screen now (it can still be the previous child's
 * until the next check), and never while a grown-up's turn is open: a grown-up who entered the
 * code is the one using SKYCOT, and the child's bedtime is not theirs.
 */
export function asleepLimitsFor(input: {
  readonly childId: string | null;
  readonly session: SessionLimits | null;
  readonly grownUpActive: boolean;
}): LimitState | null {
  if (input.childId === null || input.grownUpActive) return null;
  if (input.session === null || input.session.childId !== input.childId) return null;
  const limits = input.session.limits;
  return limits?.asleep ? limits : null;
}
