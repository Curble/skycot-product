/**
 * "Allow once" tapped on a notification: SKYCOT opens on Requests and that card starts Face ID
 * by itself, so the grown-up sees the card they are allowing while Face ID asks. Kept in the
 * app's memory only (never a link another app could open), for one minute, used once.
 *
 * The app's own notification names its request ("<macId>:<requestId>"); SKYCOT Relay's push
 * names none, so its Allow once starts Face ID only when exactly one request is waiting.
 */
const KEEP_MS = 60_000;

/** A request key, or "only" for "the one waiting request, if there is just one". */
export type AllowTarget = string;

let pending: { readonly target: AllowTarget; readonly at: number } | null = null;
const listeners = new Set<() => void>();

export function requestAllow(requestKey: string, now: number = Date.now()): void {
  pending = { target: requestKey.length > 0 ? requestKey : "only", at: now };
  for (const listener of listeners) listener();
}

/**
 * Whether the card with `requestKey` should start Face ID now; true at most once per tap.
 * `liveKeys` are the requests waiting on every linked Mac (not lapsed).
 */
export function takeAllow(
  requestKey: string,
  liveKeys: ReadonlyArray<string>,
  now: number = Date.now(),
): boolean {
  if (pending === null) return false;
  if (now - pending.at > KEEP_MS) {
    pending = null;
    return false;
  }
  const mine =
    pending.target === requestKey ||
    (pending.target === "only" && liveKeys.length === 1 && liveKeys[0] === requestKey);
  if (!mine) return false;
  pending = null;
  return true;
}

export function subscribeAllow(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests only. */
export function resetAllow(): void {
  pending = null;
}
