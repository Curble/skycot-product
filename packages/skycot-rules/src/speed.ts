// nondev-seam: skycot-rules-package
// Speed boost ("Fast / Ultrafast"). A faster tier makes replies come sooner but uses more of the
// plan, so the Family profile stays on the assistant's normal speed. The plain client offers the
// choice to a grown-up; the engine holds a Family profile to the default whatever a request
// says. Both read the same list of option ids, so a crafted request cannot slip a faster tier
// past the server by naming it differently from the screen.
import { isEffortOptionId, type SelectionOptions } from "./depth.ts";

/** The assistant options that buy faster replies at a higher price. */
export const SPEED_OPTION_IDS: ReadonlySet<string> = new Set([
  "speed",
  "serviceTier",
  "service_tier",
  "fastMode",
  "fast_mode",
]);

/** True for an option id that sets reply speed (case, spacing and "-" or "_" do not matter). */
export function isSpeedOptionId(id: string): boolean {
  const trimmed = id.trim();
  if (SPEED_OPTION_IDS.has(trimmed)) return true;
  const squash = (value: string) => value.toLowerCase().replace(/[-_\s]/g, "");
  const wanted = squash(trimmed);
  for (const known of SPEED_OPTION_IDS) if (squash(known) === wanted) return true;
  return false;
}

function without<T extends SelectionOptions>(
  options: T | undefined,
  held: (id: string) => boolean,
): T | undefined {
  if (options === undefined) return undefined;
  if (!options.some((option) => held(option.id))) return options;
  const rest = options.filter((option) => !held(option.id));
  return rest.length > 0 ? (rest as unknown as T) : undefined;
}

/**
 * The options without any speed setting, so the assistant's normal speed applies. The same
 * array when there is nothing to drop; undefined when nothing else is left.
 */
export function withoutSpeedOptions<T extends SelectionOptions>(
  options: T | undefined,
): T | undefined {
  return without(options, isSpeedOptionId);
}

/** Options without thinking depth or speed: everything the Family profile holds to default. */
export function withoutHeldOptions<T extends SelectionOptions>(
  options: T | undefined,
): T | undefined {
  return without(options, (id) => isEffortOptionId(id) || isSpeedOptionId(id));
}
