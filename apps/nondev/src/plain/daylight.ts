// Which mascot drawing to show: the sky's phase (packages/skycot-brand, shared with the desktop
// Dock) unless the person pinned one in Settings → Appearance.
import type { SkyPhase } from "@t3tools/skycot-brand/daylight";

export { phaseAt, type PhaseAt, type SkyPhase } from "@t3tools/skycot-brand/daylight";

/** Settings → Appearance → Mascot. `null` is the default: follow the sky. */
export type MascotOverride = "day" | "dusk" | null;

export const MASCOT_OVERRIDE_KEY = "skycot:mascot-sky";

export function parseMascotOverride(raw: string | null): MascotOverride {
  return raw === "day" || raw === "dusk" ? raw : null;
}

export function mascotPhase(sky: SkyPhase, override: MascotOverride): SkyPhase {
  return override ?? sky;
}

/** The device's IANA zone; UTC when the engine cannot say (the fallback times then apply). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
