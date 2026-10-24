// "Mum said yes": who answered a child's held request, from the engine's
// `/api/skycot/family/grown-up-answers` (a first name and a time, never a device).

export interface GrownUpAnswer {
  readonly requestId: string;
  readonly decision: "accept" | "decline";
  /** The grown-up's first name; null when the shared parent code answered. */
  readonly by: string | null;
  readonly at: number;
}

/** The engine's answer list, or null when the body is not one. */
export function parseGrownUpAnswers(body: unknown): ReadonlyArray<GrownUpAnswer> | null {
  const answers = (body as { answers?: unknown } | null)?.answers;
  if (!Array.isArray(answers)) return null;
  return answers.flatMap((entry): Array<GrownUpAnswer> => {
    const value = entry as Partial<GrownUpAnswer> | null;
    if (value === null || typeof value !== "object") return [];
    if (typeof value.requestId !== "string" || typeof value.at !== "number") return [];
    if (value.decision !== "accept" && value.decision !== "decline") return [];
    const by = typeof value.by === "string" && value.by.trim().length > 0 ? value.by.trim() : null;
    return [{ requestId: value.requestId, decision: value.decision, by, at: value.at }];
  });
}

/** "Mum said yes" / "A grown-up said not this time": what the child's card says. */
export function grownUpAnswerLabel(answer: Pick<GrownUpAnswer, "decision" | "by">): string {
  const who = answer.by ?? "A grown-up";
  return answer.decision === "accept" ? `${who} said yes` : `${who} said not this time`;
}
