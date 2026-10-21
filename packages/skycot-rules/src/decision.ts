// How a server-side auto-approval leaves its mark. The engine's runtime-request record has
// no "who decided" field, but `answers` (a free-form record the providers ignore for approval
// kinds) travels with every `runtime-request.respond` and is persisted on the request. The
// policy writes a namespaced note there; the client reads it back for "Show details".

import type { HardRuleId, RuleEvaluation } from "./rules.ts";

export const SKYCOT_POLICY_NOTE = "allowed by SKYCOT rules";
export const SKYCOT_ANSWERS_KEY = "skycot";

export interface SkycotPolicyDecision {
  readonly decidedBy: "policy";
  readonly note: string;
  /** Rules that matched; empty when the request was allowed. */
  readonly ruleIds: ReadonlyArray<HardRuleId>;
  readonly version: 1;
}

/** The `answers` payload the policy attaches to an auto-approved request. */
export function policyDecisionAnswers(evaluation: RuleEvaluation): Record<string, unknown> {
  const decision: SkycotPolicyDecision = {
    decidedBy: "policy",
    note: SKYCOT_POLICY_NOTE,
    ruleIds: evaluation.matches.map((match) => match.rule.id),
    version: 1,
  };
  return { [SKYCOT_ANSWERS_KEY]: decision };
}

/** The note back out of a resolved request's `answers`, or null when a person decided. */
export function readPolicyDecision(
  answers: Readonly<Record<string, unknown>> | undefined | null,
): SkycotPolicyDecision | null {
  const raw = answers?.[SKYCOT_ANSWERS_KEY];
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (record.decidedBy !== "policy" || typeof record.note !== "string") return null;
  const ruleIds = Array.isArray(record.ruleIds)
    ? record.ruleIds.filter((id): id is HardRuleId => typeof id === "string")
    : [];
  return { decidedBy: "policy", note: record.note, ruleIds, version: 1 };
}
