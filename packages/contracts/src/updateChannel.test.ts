// nondev-seam: skycot-update-staging-contract-test
import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { DesktopUpdateChannelSchema } from "./ipc.ts";

describe("DesktopUpdateChannelSchema", () => {
  it("knows latest, nightly and staging, and nothing else", () => {
    const decode = Schema.decodeUnknownSync(DesktopUpdateChannelSchema);
    for (const channel of ["latest", "nightly", "staging"]) expect(decode(channel)).toBe(channel);
    expect(() => decode("beta")).toThrow();
  });
});
