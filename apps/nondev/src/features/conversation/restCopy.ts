// nondev-seam: skycot-iphone-q47-mac-rest-copy
export function restCopy(resetAt: string | null): ReadonlyArray<string> {
  if (resetAt === null)
    return ["Sam is resting. Your work is saved.", "You could draw while Sam rests."];
  const time = new Date(resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return [
    `Sam can come back around ${time}.`,
    "You could draw what you want to make while Sam rests.",
  ];
}

export function isAllowanceRestRun(
  runId: string | null,
  items: ReadonlyArray<{
    readonly type: string;
    readonly runId: string | null;
    readonly failure?: { readonly class: string };
  }>,
): boolean {
  return (
    runId !== null &&
    items.some(
      (item) =>
        item.runId === runId && item.type === "error" && item.failure?.class === "usage_limit",
    )
  );
}
