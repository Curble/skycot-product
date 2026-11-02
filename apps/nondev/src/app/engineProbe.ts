// Quick "is the engine answering?" check used by the connection banner.
//
// Why this exists: the shared connection layer backs off exponentially after a
// failed attempt (the wait can grow to several minutes, with jitter), and it
// only retries sooner when something wakes it (a returning tab, or the
// banner's "Try now"). So after the Mac engine came back the banner could stay
// for 20-40 s. While the banner is showing we ask the engine directly every few
// seconds, and the moment it answers we send the same wakeup as "Try now".
import { environmentEndpointUrl } from "@t3tools/client-runtime/environment";

import { readPrimaryEnvironmentTarget } from "~/environments/primary/target";

/** How often to ask while the banner is showing. */
export const ENGINE_PROBE_INTERVAL_MS = 4000;
/** After a wakeup, wait this long before sending another (lets the reconnect finish). */
export const ENGINE_WAKE_COOLDOWN_MS = 10000;
const ENGINE_PROBE_TIMEOUT_MS = 3000;

/** True when a wakeup is due: the engine answered and we have not just sent one. */
export function shouldWake(answered: boolean, lastWakeMs: number | null, nowMs: number): boolean {
  if (!answered) return false;
  return lastWakeMs === null || nowMs - lastWakeMs >= ENGINE_WAKE_COOLDOWN_MS;
}

/** Asks the engine's own descriptor address; any HTTP answer in the 2xx range counts. */
export async function engineAnswers(): Promise<boolean> {
  try {
    const target = readPrimaryEnvironmentTarget();
    if (target === null) return false;
    const response = await fetch(
      environmentEndpointUrl(target.target.httpBaseUrl, "/.well-known/t3/environment"),
      { cache: "no-store", signal: AbortSignal.timeout(ENGINE_PROBE_TIMEOUT_MS) },
    );
    return response.ok;
  } catch {
    return false;
  }
}
