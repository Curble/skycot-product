// nondev-seam: skycot-rules-package
// Thinking depth ("Careful / Balanced / Quick"). The plain client offers it to a grown-up; the
// engine holds a Family profile to the assistant's own default whatever a request says. Both
// read the same list of option ids, so a crafted request cannot slip an effort setting past the
// server by naming it differently from the screen.

/** The assistant options that set how long it thinks before answering. */
export const EFFORT_OPTION_IDS: ReadonlySet<string> = new Set([
  "reasoningEffort",
  "effort",
  "reasoning",
  "thinking",
  "thinkingLevel",
  "reasoning_effort",
]);

/** True for an option id that sets thinking depth (case and spacing do not matter). */
export function isEffortOptionId(id: string): boolean {
  const trimmed = id.trim();
  if (EFFORT_OPTION_IDS.has(trimmed)) return true;
  const lowered = trimmed.toLowerCase();
  for (const known of EFFORT_OPTION_IDS) if (known.toLowerCase() === lowered) return true;
  return false;
}

/** A model selection's options as the engine holds them: a list of id and value. */
export type SelectionOptions = ReadonlyArray<{ readonly id: string; readonly value: unknown }>;

/**
 * The options without any thinking-depth setting, so the assistant's own default applies. The
 * same array when there is nothing to drop; undefined when nothing else is left.
 */
export function withoutEffortOptions<T extends SelectionOptions>(
  options: T | undefined,
): T | undefined {
  if (options === undefined) return undefined;
  if (!options.some((option) => isEffortOptionId(option.id))) return options;
  const rest = options.filter((option) => !isEffortOptionId(option.id));
  return rest.length > 0 ? (rest as unknown as T) : undefined;
}
