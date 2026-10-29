import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

/**
 * What "Try again" sends: the child's own message just before the error at `index`.
 * Null when there is none, or when a newer message or error came after it (the stuck
 * moment is over, so a button on an old error would only confuse).
 */
export function retryTextFor(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  index: number,
): string | null {
  for (let after = index + 1; after < items.length; after += 1) {
    const later = items[after];
    if (later && (later.type === "user_message" || later.type === "error")) return null;
  }
  for (let before = index - 1; before >= 0; before -= 1) {
    const earlier = items[before];
    if (earlier?.type === "user_message" && earlier.createdBy === "user") {
      const text = earlier.text.trim();
      return text.length > 0 ? text : null;
    }
  }
  return null;
}
