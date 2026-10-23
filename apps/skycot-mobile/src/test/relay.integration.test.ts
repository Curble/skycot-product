/**
 * Through SKYCOT Relay, against a local relay and engine: SKYCOT_TEST_RELAY_LINK is a whole
 * link from a Mac's QR code with the relay's part (a fresh one). Skipped otherwise. Links the
 * way the app does when the Mac's own address isn't reachable, then reads and sends a command
 * through the sealed tunnel only.
 */
import { newHomeRecord, RelayHome } from "@t3tools/skycot-relay/client/home";
import { describe, expect, it } from "vite-plus/test";

import { readMacConfig, readShell } from "../engine/engine";
import { familyApi } from "../family/api";
import { linkToMac, readLinkInput } from "../links/pairing";
import { waysToMac } from "../transport/ways";

const link = process.env.SKYCOT_TEST_RELAY_LINK;

describe.skipIf(link === undefined)("SKYCOT Relay", () => {
  it("links, reads and sends commands through the tunnel alone", async () => {
    const target = readLinkInput({ kind: "scanned", text: link! });
    expect(target.relay).not.toBeNull();
    expect(target.httpBaseUrl).toBeNull();
    const relay = new RelayHome({ record: newHomeRecord(target.relay!), save: () => undefined });
    const linked = await linkToMac(target, {
      ways: (bearerToken) => waysToMac({ httpBaseUrl: null, bearerToken, relay }),
    });
    expect(linked.me.kind).toBe("grown-up");
    const transport = waysToMac({ httpBaseUrl: null, bearerToken: linked.bearerToken, relay });
    expect(transport.kind).toBe("relay");
    const status = await familyApi.status(transport);
    expect(status.ok).toBe(true);
    const requests = await familyApi.pendingRequests(transport);
    expect(requests.ok).toBe(true);
    expect((await readShell(transport)).threads.length).toBeGreaterThan(0);
    // The engine's RPC channel (a WebSocket) through the tunnel too.
    expect((await readMacConfig(transport)).providers.length).toBeGreaterThan(0);
    relay.close();
  }, 60_000);
});
