// What a child sees after "Ask for more time": who was asked, then the grown-up's answer, read
// from the child's own family notes (`/api/skycot/family/notes/child`).

export interface MoreTimeAnswer {
  readonly minutes: 0 | 15 | 30;
  /** The answering grown-up's first name. */
  readonly by: string;
}

/** "Mum", "Mum or Dad", or "a grown-up" when nobody has a name yet. */
export function askedWho(names: ReadonlyArray<string | null>): string {
  const named = names
    .map((name) => name?.trim().split(/\s+/u)[0] ?? "")
    .filter((name) => name.length > 0);
  if (named.length === 0) return "a grown-up";
  if (named.length === 1) return named[0]!;
  return `${named.slice(0, -1).join(", ")} or ${named.at(-1)}`;
}

/** The answer on this child's more-time note, once a grown-up gave one. */
export function moreTimeAnswerFor(
  notes: ReadonlyArray<unknown>,
  noteId: string,
): MoreTimeAnswer | null {
  for (const entry of notes) {
    const note = entry as { id?: unknown; kind?: unknown; answer?: unknown } | null;
    if (note?.id !== noteId || note.kind !== "more-time") continue;
    const answer = note.answer as { minutes?: unknown; by?: unknown } | undefined;
    if (answer === undefined) return null;
    const minutes = answer.minutes;
    if (minutes !== 0 && minutes !== 15 && minutes !== 30) return null;
    const by = typeof answer.by === "string" && answer.by.trim() ? answer.by.trim() : "A grown-up";
    return { minutes, by };
  }
  return null;
}

export function moreTimeAnswerLine(answer: MoreTimeAnswer): string {
  return answer.minutes === 0
    ? `${answer.by} said not tonight. Your work is saved for next time.`
    : `${answer.by} gave you ${answer.minutes} more minutes!`;
}
