import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

type PinFields = Pick<EnvironmentThreadShell, "pinnedAt" | "pinOrderKey">;

/** Whether the conversation is pinned to the top of the list. */
export function isPinned(shell: Partial<PinFields>): boolean {
  return shell.pinnedAt != null;
}

/** The menu row's words: one action, whichever applies now. */
export function pinMenuLabel(shell: Partial<PinFields>): "Pin to top" | "Unpin" {
  return isPinned(shell) ? "Unpin" : "Pin to top";
}

/** The toast after pinning or unpinning. */
export function pinToastMessage(nowPinned: boolean): "Pinned to the top" | "Unpinned" {
  return nowPinned ? "Pinned to the top" : "Unpinned";
}

/**
 * Order among pinned conversations: the engine's order key when both have one (smaller is
 * higher), otherwise the most recently pinned first. Keyed pins sit above keyless ones.
 */
export function comparePinned(a: Partial<PinFields>, b: Partial<PinFields>): number {
  const aKey = a.pinOrderKey ?? null;
  const bKey = b.pinOrderKey ?? null;
  if (aKey !== null && bKey !== null && aKey !== bKey) return aKey < bKey ? -1 : 1;
  if ((aKey === null) !== (bKey === null)) return aKey === null ? 1 : -1;
  return (Date.parse(b.pinnedAt ?? "") || 0) - (Date.parse(a.pinnedAt ?? "") || 0);
}

/**
 * Pulls the pinned rows out, in pin order; the rest keep the order they came in.
 * Nothing is added or dropped, so what a person can see does not change.
 */
export function splitPinned<T extends { readonly shell: Partial<PinFields> }>(
  rows: ReadonlyArray<T>,
): { readonly pinned: ReadonlyArray<T>; readonly rest: ReadonlyArray<T> } {
  const pinned = rows.filter((row) => isPinned(row.shell));
  const rest = rows.filter((row) => !isPinned(row.shell));
  return { pinned: [...pinned].sort((a, b) => comparePinned(a.shell, b.shell)), rest };
}
