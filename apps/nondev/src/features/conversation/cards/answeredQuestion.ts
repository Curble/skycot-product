export function answeredQuestionNote(
  question: string,
  answers: Readonly<Record<string, unknown>>,
): { readonly asked: string; readonly answered: string } {
  const answer = Object.values(answers)
    .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(", ");
  return {
    asked: `You asked Sam: ${question}`,
    answered: `You answered: ${answer || "You sent your answer."}`,
  };
}
