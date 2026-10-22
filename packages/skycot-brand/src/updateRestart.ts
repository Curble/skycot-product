/**
 * The Family profile's rule for installing a SKYCOT update: restarting into a new version needs
 * the parent code. Checking and downloading stay open (nothing changes until the restart).
 *
 * The desktop app installs the update, but the engine keeps the parent code. So the engine, once
 * a grown-up has entered the code, writes a short-lived "restart allowed" note beside the Family
 * profile (`<T3 home>/userdata/skycot-update-unlock.json`, naming the one version agreed to), and
 * the desktop's install handler reads and removes it before it restarts. With the profile on and
 * no fresh note for that version, the desktop refuses, whichever screen asked.
 *
 * Shared by the engine (writer) and the desktop (reader). Pure: callers pass file text and time.
 */

export const FAMILY_PROFILE_FILE_NAME = "skycot-family.json";
export const RESTART_UNLOCK_FILE_NAME = "skycot-update-unlock.json";
/** Long enough to read the warning and press Restart; short enough that it is not left lying open. */
export const RESTART_UNLOCK_TTL_MS = 2 * 60_000;

export interface RestartUnlock {
  readonly version: string;
  readonly expiresAt: number;
}

/**
 * Whether the Family profile is on, from its file's text (null when there is no file). A file
 * that cannot be read as a profile counts as on: the desktop fails closed, as the engine would
 * refuse the parent code for a broken file anyway.
 */
export function familyProfileOn(text: string | null): boolean {
  if (text === null) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return true;
    return (parsed as Record<string, unknown>)["enabled"] !== false;
  } catch {
    return true;
  }
}

export function encodeRestartUnlock(unlock: RestartUnlock): string {
  return `${JSON.stringify({ version: unlock.version, expiresAt: unlock.expiresAt })}\n`;
}

/** Whether a note (its text, or null when there is none) allows restarting into `version` now. */
export function restartUnlockAllows(
  text: string | null,
  version: string | null,
  now: number,
): boolean {
  if (text === null || version === null) return false;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const expiresAt = parsed["expiresAt"];
    return (
      parsed["version"] === version &&
      typeof expiresAt === "number" &&
      expiresAt > now &&
      // A note dated far ahead was not written by the engine's two-minute rule.
      expiresAt <= now + RESTART_UNLOCK_TTL_MS + 5_000
    );
  } catch {
    return false;
  }
}
