import * as DateTime from "effect/DateTime";

import { formatRowTime } from "../status";

/** Projection timestamps arrive as DateTime.Utc; shells carry ISO strings. Accept both. */
export function toIso(value: DateTime.Utc | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : DateTime.formatIso(value);
}

/** "8:42 pm" today, "Yesterday", "Mon", or "3 Oct". Empty when unknown. */
export function shortTime(value: DateTime.Utc | string | null | undefined): string {
  const iso = toIso(value);
  return iso === null ? "" : formatRowTime(iso);
}
