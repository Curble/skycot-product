// The tunnel's door in front of the engine: only the linked device's own sign-in passes, only
// the pairing routes pass without one, and a sign-in made for another device is revoked.
// A real HTTP server on loopback stands in for the engine.
// @effect-diagnostics nodeBuiltinImport:off globalFetch:off
import * as NodeHttp from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { TunnelContext, TunnelResponse } from "@t3tools/skycot-relay/host";
import { deviceIdFromSubject, deviceSubject } from "@t3tools/skycot-rules/people";

import { makeTunnelHandler, type AuthenticatedSession } from "./tunnelHandler.ts";

const seen: Array<{ method: string; url: string; headers: NodeHttp.IncomingHttpHeaders }> = [];
let origin = "";
let server: NodeHttp.Server;
let mintedFor = "d0aaaaaa";

beforeAll(async () => {
  server = NodeHttp.createServer((request, response) => {
    seen.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers });
    if (request.url === "/api/auth/browser-session") {
      response.setHeader("set-cookie", [`t3_session=session-for-${mintedFor}; Path=/; HttpOnly`]);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ authenticated: true }));
      return;
    }
    response.setHeader("content-type", "text/plain");
    response.end(`engine saw ${request.method} ${request.url}`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Sessions by cookie value: who the engine would say each one is. */
const sessions: Record<string, AuthenticatedSession> = {
  "session-for-d0aaaaaa": { sessionId: "s-ava", subject: deviceSubject("d0aaaaaa") },
  "session-for-d0bbbbbb": { sessionId: "s-leo", subject: deviceSubject("d0bbbbbb") },
  "the-macs-own": { sessionId: "s-mac", subject: "owner" },
};

function setup() {
  const revoked: Array<string> = [];
  const handler = makeTunnelHandler({
    loopbackOrigin: origin,
    authenticate: async ({ headers }) => {
      const cookie = headers.find(([name]) => name === "cookie")?.[1] ?? "";
      const value = /t3_session=([^;]+)/.exec(cookie)?.[1];
      return value === undefined ? null : (sessions[value] ?? null);
    },
    familyDeviceFor: async (deviceRelayId) => (deviceRelayId === "relay-ava" ? "d0aaaaaa" : null),
    familyDeviceOf: deviceIdFromSubject,
    revokeSession: async (sessionId) => {
      revoked.push(sessionId);
    },
    control: async () => ({}),
    log: () => undefined,
  });
  const context: TunnelContext = {
    connectionId: "0000000000000001",
    deviceRelayId: "relay-ava",
    deviceKey: "key",
    mode: "linked",
  };
  return { handler, context, revoked };
}

async function text(response: TunnelResponse): Promise<string> {
  if (response.body instanceof Uint8Array) return new TextDecoder().decode(response.body);
  let out = "";
  for await (const chunk of response.body) out += new TextDecoder().decode(chunk);
  return out;
}

const request = (
  method: string,
  path: string,
  headers: ReadonlyArray<readonly [string, string]> = [],
) => ({ method, path, headers });

describe("requests through the relay", () => {
  it("carry the linked device's own sign-in to the engine, minus the hop's headers", async () => {
    const { handler, context } = setup();
    const response = await handler.request(
      context,
      request("GET", "/api/skycot/family?x=1", [
        ["cookie", "t3_session=session-for-d0aaaaaa"],
        ["origin", "https://relay.example"],
        ["x-forwarded-for", "203.0.113.9"],
        ["user-agent", "Ava's iPad"],
      ]),
      new Uint8Array(0),
      new AbortController().signal,
    );
    expect(response.status).toBe(200);
    expect(await text(response)).toBe("engine saw GET /api/skycot/family?x=1");
    const last = seen.at(-1)!;
    expect(last.headers["cookie"]).toBe("t3_session=session-for-d0aaaaaa");
    expect(last.headers["origin"]).toBeUndefined();
    expect(last.headers["x-forwarded-for"]).toBeUndefined();
    expect(last.headers["accept-encoding"]).toBe("identity");
    expect(last.headers["user-agent"]).toBe("Ava's iPad");
  });

  it("refuse any other session, even the Mac's own", async () => {
    const { handler, context } = setup();
    for (const cookie of ["t3_session=the-macs-own", "t3_session=session-for-d0bbbbbb"]) {
      const before = seen.length;
      const response = await handler.request(
        context,
        request("GET", "/api/orchestration/shell", [["cookie", cookie]]),
        new Uint8Array(0),
        new AbortController().signal,
      );
      expect(response.status).toBe(403);
      expect(seen.length).toBe(before);
    }
  });

  it("carry only the pairing routes without a sign-in", async () => {
    const { handler, context } = setup();
    const open = await handler.request(
      context,
      request("GET", "/api/auth/session"),
      new Uint8Array(0),
      new AbortController().signal,
    );
    expect(open.status).toBe(200);
    const closed = await handler.request(
      context,
      request("GET", "/api/orchestration/shell"),
      new Uint8Array(0),
      new AbortController().signal,
    );
    expect(closed.status).toBe(401);
  });

  it("never carry web pages or the agents' MCP door", async () => {
    const { handler, context } = setup();
    for (const path of ["/simple/", "/", "/mcp", "/pair"]) {
      const response = await handler.request(
        context,
        request("GET", path, [["cookie", "t3_session=session-for-d0aaaaaa"]]),
        new Uint8Array(0),
        new AbortController().signal,
      );
      expect(response.status).toBe(404);
    }
  });

  it("refuse a relay id the Mac does not know", async () => {
    const { handler, context } = setup();
    const response = await handler.request(
      { ...context, deviceRelayId: "relay-unknown" },
      request("GET", "/api/auth/session"),
      new Uint8Array(0),
      new AbortController().signal,
    );
    expect(response.status).toBe(403);
  });

  it("hand over a sign-in made through the tunnel only when it is this device's", async () => {
    const { handler, context, revoked } = setup();
    mintedFor = "d0aaaaaa";
    const good = await handler.request(
      context,
      request("POST", "/api/auth/browser-session", [["content-type", "application/json"]]),
      new TextEncoder().encode(JSON.stringify({ credential: "ABCDEFGHJKLM" })),
      new AbortController().signal,
    );
    expect(good.status).toBe(200);
    expect(
      good.headers.some(
        ([name, value]) => name === "set-cookie" && value.includes("session-for-d0aaaaaa"),
      ),
    ).toBe(true);

    mintedFor = "d0bbbbbb";
    const foreign = await handler.request(
      context,
      request("POST", "/api/auth/browser-session", [["content-type", "application/json"]]),
      new TextEncoder().encode(JSON.stringify({ credential: "LEOSCODE2345" })),
      new AbortController().signal,
    );
    expect(foreign.status).toBe(403);
    expect(foreign.headers.some(([name]) => name === "set-cookie")).toBe(false);
    expect(revoked).toEqual(["s-leo"]);
  });

  it("refuse a WebSocket without the device's sign-in before dialling the engine", async () => {
    const { handler, context } = setup();
    const result = await handler.socket(
      context,
      { path: "/ws", protocols: [], headers: [["cookie", "t3_session=the-macs-own"]] },
      { message: () => undefined, close: () => undefined },
    );
    expect("refused" in result && result.refused.status).toBe(403);
  });
});
