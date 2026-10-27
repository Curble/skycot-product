export const PICKER_IDLE_MS = 60 * 60_000;

export const CHILD_PICK_MEMORY_MS = 8 * 60 * 60_000;
const LAST_CHILD_KEY = "skycot:family:last-child";

/** Digits typed during the picker-to-code-field handoff, or null when the key is unrelated. */
export function bufferPickerCode(current: string, key: string): string | null {
  if (/^\d$/u.test(key)) return `${current}${key}`.slice(0, 6);
  if (key === "Backspace") return current.slice(0, -1);
  return null;
}

export function rememberChild(childId: string, selectedAt: number): void {
  try {
    window.localStorage.setItem(LAST_CHILD_KEY, JSON.stringify({ childId, selectedAt }));
  } catch {
    // The picker can still be used normally when storage is unavailable.
  }
}

export function rememberedChild(now: number): string | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(LAST_CHILD_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return null;
    const entry = value as { childId?: unknown; selectedAt?: unknown };
    return typeof entry.childId === "string" &&
      typeof entry.selectedAt === "number" &&
      rememberedChildIsFresh(entry.selectedAt, now)
      ? entry.childId
      : null;
  } catch {
    return null;
  }
}

export function forgetRememberedChild(): void {
  try {
    window.localStorage.removeItem(LAST_CHILD_KEY);
  } catch {
    // Nothing stored.
  }
}

export function pickerAfterIdle(lastInputAt: number, now: number): boolean {
  return now - lastInputAt >= PICKER_IDLE_MS;
}

export function shouldShowChildPicker(input: {
  readonly shared: boolean;
  readonly requested: boolean;
  readonly childCount: number;
  readonly grownUpActive: boolean;
  readonly needsChoice: boolean;
  readonly picked: boolean;
}): boolean {
  return (
    input.shared &&
    (input.requested ||
      (input.childCount > 1 && !input.grownUpActive && (input.needsChoice || !input.picked)))
  );
}

export function rememberedChildIsFresh(selectedAt: number, now: number): boolean {
  return now - selectedAt >= 0 && now - selectedAt < CHILD_PICK_MEMORY_MS;
}

/** A fresh tab may reuse the engine's current child; an old choice must go through the picker. */
export function canReuseCurrentChild(input: {
  readonly childCount: number;
  readonly currentChildId: string | null;
  readonly rememberedChildId: string | null;
}): boolean {
  return (
    input.childCount > 1 &&
    input.currentChildId !== null &&
    input.currentChildId === input.rememberedChildId
  );
}
