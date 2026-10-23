import { describe, expect, it } from "vite-plus/test";

import {
  failoverTransport,
  MacUnreachableError,
  routeLabelFor,
  type MacTransport,
} from "./MacTransport";

function way(
  kind: "direct" | "relay",
  answer: () => Promise<{ status: number; json: unknown }>,
): MacTransport {
  return {
    kind,
    routeLabel: kind,
    request: answer,
    socket: () => Promise.reject(new MacUnreachableError("no socket")),
  };
}

describe("ways to the Mac", () => {
  it("uses the relay first, the home address when the relay doesn't answer, and stays there", async () => {
    let relayCalls = 0;
    const relay = way("relay", () => {
      relayCalls += 1;
      return Promise.reject(new MacUnreachableError("relay down"));
    });
    const direct = way("direct", () => Promise.resolve({ status: 200, json: { ok: true } }));
    const both = failoverTransport([relay, direct]);
    expect(both.kind).toBe("relay");
    expect((await both.request({ method: "GET", path: "/x" })).status).toBe(200);
    expect(both.kind).toBe("direct");
    await both.request({ method: "GET", path: "/x" });
    expect(relayCalls).toBe(1);
  });

  it("never treats the Mac's own refusal as a reason to try elsewhere", async () => {
    const refused = way("relay", () =>
      Promise.resolve({ status: 403, json: { error: "removed" } }),
    );
    const direct = way("direct", () => Promise.resolve({ status: 200, json: {} }));
    expect(
      (await failoverTransport([refused, direct]).request({ method: "GET", path: "/" })).status,
    ).toBe(403);
  });

  it("names the route in plain words", () => {
    expect(routeLabelFor("http://192.168.1.20:3773")).toBe("Home Wi-Fi");
    expect(routeLabelFor("https://mamabear.tail1234.ts.net")).toBe("Tailscale");
    expect(routeLabelFor("http://100.101.1.2:3773")).toBe("Tailscale");
  });
});
