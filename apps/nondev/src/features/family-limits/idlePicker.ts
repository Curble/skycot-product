export const PICKER_IDLE_MS = 20 * 60_000;

export function pickerAfterIdle(lastInputAt: number, now: number): boolean {
  return now - lastInputAt >= PICKER_IDLE_MS;
}
