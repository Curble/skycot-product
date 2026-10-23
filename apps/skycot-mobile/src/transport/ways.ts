/**
 * Every way this device has to one Mac, put together: SKYCOT Relay's sealed tunnel first when
 * the Mac's link carried one (it works at home and away), then the Mac's own address on the
 * home Wi-Fi or Tailscale as the fallback. The device's sign-in is the same either way; the
 * relay only carries it (WHO-IS-WHO, "The relay must not become a judge").
 */
import { RelayHome, type HomeRecord } from "@t3tools/skycot-relay/client/home";

import {
  directTransport,
  failoverTransport,
  relayTransport,
  type MacTransport,
} from "./MacTransport";

const homes = new Map<string, RelayHome>();

/** One tunnel per Mac for the life of the app; `save` keeps its record (keys, pass, cookies). */
export function relayHomeFor(record: HomeRecord, save: (record: HomeRecord) => void): RelayHome {
  const existing = homes.get(record.homeId);
  if (existing !== undefined) return existing;
  const home = new RelayHome({ record, save });
  homes.set(record.homeId, home);
  return home;
}

export function closeRelayHome(homeId: string): void {
  homes.get(homeId)?.close();
  homes.delete(homeId);
}

export function waysToMac(input: {
  readonly httpBaseUrl: string | null;
  readonly bearerToken: string | null;
  readonly relay: RelayHome | null;
}): MacTransport {
  const ways: Array<MacTransport> = [];
  if (input.relay !== null) ways.push(relayTransport(input.relay, input.bearerToken));
  if (input.httpBaseUrl !== null) {
    ways.push(directTransport({ httpBaseUrl: input.httpBaseUrl, bearerToken: input.bearerToken }));
  }
  return ways.length === 1 ? ways[0]! : failoverTransport(ways);
}
