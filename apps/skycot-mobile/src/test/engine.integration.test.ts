/**
 * Against a real engine: SKYCOT_TEST_ENGINE=http://127.0.0.1:3895 with SKYCOT_TEST_CHILD_CODE
 * (a fresh child link). Skipped otherwise. Checks the link, the identity, the reads and one
 * command over the RPC channel, the same way the app does them.
 */
import { describe, expect, it } from "vite-plus/test";

import { familyApi } from "../family/api";
import { defaultModelSelection, readProviders, readShell } from "../engine/engine";
import { linkToMac, readLinkInput } from "../links/pairing";
import { directTransport } from "../transport/MacTransport";

const base = process.env.SKYCOT_TEST_ENGINE;
const code = process.env.SKYCOT_TEST_CHILD_CODE;

describe.skipIf(base === undefined || code === undefined)("a live engine", () => {
  it("links a child's device and reads only its own work", async () => {
    const target = readLinkInput({ kind: "typed", code: code!, address: base! });
    const linked = await linkToMac(target, { deviceLabel: "Test iPad", deviceType: "tablet" });
    expect(linked.me.kind).toBe("child");
    const transport = directTransport({
      httpBaseUrl: linked.httpBaseUrl!,
      bearerToken: linked.bearerToken,
    });
    const status = await familyApi.status(transport);
    expect(status.ok).toBe(true);
    const shell = await readShell(transport);
    expect(Array.isArray(shell.projects)).toBe(true);
    const providers = await readProviders(transport);
    expect(defaultModelSelection(providers, null)).not.toBeNull();
  });
});
