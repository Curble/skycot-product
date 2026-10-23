import { describe, expect, it } from "vite-plus/test";

import { newHomeRecord, RelayHome, type HomeRecord, type HomeStatus } from "./client/home.ts";
import { installRelayShim, routesThroughRelay } from "./client/shim.ts";
import { fromUtf8, toBase64Url, utf8 } from "./encoding.ts";
import {
  HostTunnel,
  type Admission,
  type DeviceDirectory,
  type HostEvent,
  type SocketPeer,
  type TunnelHandler,
} from "./host.ts";
import { parseRelayLink, relayLinkParams } from "./link.ts";
import { MemoryRelay } from "./memoryRelay.testkit.ts";
import { MAX_CHUNK } from "./mux.ts";
import { generateKeyPair } from "./noise.ts";
import {
  generateSigningKeyPair,
  homeIdFor,
  newDeviceRelayId,
  signPass,
  verifyPass,
} from "./pass.ts";
import { encodeHostFrame, HostFrameKind } from "./protocol.ts";

/** A fixed clock: passes and hellos are judged against it, never the machine's time. */
const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;

const timers = {
  setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The Mac's side of the directory: which key belongs to which relay id, and its last hello. */
class TestDirectory implements DeviceDirectory {
  readonly expected = new Set<string>();
  readonly bound = new Map<string, { key: string; lastTimestamp: number }>();
  readonly removed = new Set<string>();

  async admit(input: {
    deviceRelayId: string;
    deviceKey: string;
    timestamp: number;
  }): Promise<Admission> {
    if (this.removed.has(input.deviceRelayId)) return { ok: false, reason: "removed" };
    const known = this.bound.get(input.deviceRelayId);
    if (known === undefined) {
      if (!this.expected.has(input.deviceRelayId)) return { ok: false, reason: "unknown" };
      this.bound.set(input.deviceRelayId, { key: input.deviceKey, lastTimestamp: input.timestamp });
      return { ok: true, mode: "pairing" };
    }
    if (known.key !== input.deviceKey) return { ok: false, reason: "wrong key" };
    if (input.timestamp <= known.lastTimestamp) return { ok: false, reason: "replay" };
    known.lastTimestamp = input.timestamp;
    return { ok: true, mode: "linked" };
  }
}

/** A tiny stand-in for the engine's HTTP and WebSocket API. */
const engine: TunnelHandler = {
  async request(_context, head, body) {
    if (head.path === "/api/login") {
      return {
        status: 200,
        headers: [
          ["content-type", "application/json"],
          ["set-cookie", "t3_session=secret-session-value; Path=/; HttpOnly"],
        ],
        body: utf8(JSON.stringify({ ok: true })),
      };
    }
    if (head.path.startsWith("/api/whoami")) {
      const cookie = head.headers.find(([name]) => name === "cookie")?.[1] ?? null;
      return {
        status: 200,
        headers: [["content-type", "application/json"]],
        body: utf8(JSON.stringify({ cookie })),
      };
    }
    if (head.path === "/api/echo") {
      return { status: 201, headers: [["x-length", String(body.length)]], body };
    }
    if (head.path === "/api/stream") {
      async function* parts() {
        yield utf8("part one, ");
        yield utf8("part two");
      }
      return { status: 200, headers: [], body: parts() };
    }
    return { status: 404, headers: [], body: utf8("not here") };
  },
  async socket(_context, open, peer: SocketPeer) {
    if (open.path.split("?")[0] !== "/ws")
      return { refused: { status: 401, headers: [], body: utf8("Sign in") } };
    return {
      protocol: open.protocols[0] ?? "",
      send: (data) => peer.message(typeof data === "string" ? `echo:${data}` : data),
      close: () => undefined,
    };
  },
  async control(_context, request) {
    return { ok: true, op: request["op"] };
  },
};

function setup(options: { readonly passHome?: string } = {}) {
  const signingKey = generateSigningKeyPair();
  const noiseKey = generateKeyPair();
  const homeId = homeIdFor(signingKey.publicKey);
  const relay = new MemoryRelay(homeId, () => NOW_S);
  const directory = new TestDirectory();
  const events: Array<HostEvent> = [];
  const watchers = new Set<{ match: (event: HostEvent) => boolean; resolve: () => void }>();
  const waitForEvent = (match: (event: HostEvent) => boolean) =>
    events.some(match)
      ? Promise.resolve()
      : new Promise<void>((resolve) => watchers.add({ match, resolve }));
  const host = new HostTunnel({
    homeId,
    noiseKey,
    signingKey,
    directory,
    handler: engine,
    transport: relay.hostTransport(),
    timers,
    onEvent: (event) => {
      events.push(event);
      for (const watcher of watchers) {
        if (watcher.match(event)) {
          watchers.delete(watcher);
          watcher.resolve();
        }
      }
    },
  });
  relay.attachHost(host);

  const linkDevice = (overrides: Partial<HomeRecord> = {}) => {
    const deviceRelayId = newDeviceRelayId();
    directory.expected.add(deviceRelayId);
    const pass = signPass(signingKey, {
      homeId: options.passHome ?? homeId,
      deviceRelayId,
      expiresAt: NOW_S + 3600,
    });
    const fragment = new URLSearchParams([
      ["token", "ABCDEFGHJKLM"],
      ...relayLinkParams({
        relayUrl: "https://relay.example",
        hostSigningKey: toBase64Url(signingKey.publicKey),
        hostNoiseKey: toBase64Url(noiseKey.publicKey),
        deviceRelayId,
        pass,
      }),
    ]).toString();
    const link = parseRelayLink(`#${fragment}`);
    const record: HomeRecord = {
      ...(link === null
        ? {
            ...newHomeRecord({
              relayUrl: "https://relay.example",
              hostSigningKey: toBase64Url(signingKey.publicKey),
              hostNoiseKey: toBase64Url(noiseKey.publicKey),
              deviceRelayId,
              pass,
              homeId,
              token: null,
            }),
          }
        : newHomeRecord(link)),
      ...overrides,
    };
    const statuses: Array<HomeStatus> = [];
    const statusWaiters = new Set<{ status: HomeStatus; resolve: () => void }>();
    const waitForStatus = (status: HomeStatus) =>
      new Promise<void>((resolve) => statusWaiters.add({ status, resolve }));
    let saved = record;
    const home = new RelayHome({
      record,
      save: (next) => {
        saved = next;
      },
      connect: relay.connect,
      now: () => NOW_MS,
      timers,
      readyTimeoutMs: 2000,
      onStatus: (status) => {
        statuses.push(status);
        for (const waiter of statusWaiters) {
          if (waiter.status !== status) continue;
          statusWaiters.delete(waiter);
          waiter.resolve();
        }
      },
    });
    return { home, deviceRelayId, link, statuses, waitForStatus, saved: () => saved };
  };

  return { signingKey, noiseKey, homeId, relay, directory, host, events, waitForEvent, linkDevice };
}

describe("SKYCOT Relay tunnel", () => {
  it("carries the Mac's HTTP API with its session cookie, and the relay sees only sealed bytes", async () => {
    const { linkDevice, relay } = setup();
    const { home, link, saved } = linkDevice();
    expect(link?.token).toBe("ABCDEFGHJKLM");

    const login = await home.fetch("https://mac.invalid/api/login", {
      method: "POST",
      body: "code=1234",
    });
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({ ok: true });
    expect(login.headers.get("set-cookie")).toBeNull();
    expect(saved().cookies["t3_session"]?.value).toBe("secret-session-value");

    const whoami = await home.fetch("https://mac.invalid/api/whoami?child=ava");
    expect(await whoami.json()).toEqual({ cookie: "t3_session=secret-session-value" });

    const seen = relay.forwardedText();
    expect(relay.forwarded.length).toBeGreaterThan(4);
    for (const secret of [
      "/api/whoami",
      "secret-session-value",
      "code=1234",
      "child=ava",
      "cookie",
    ]) {
      expect(seen.includes(secret)).toBe(false);
    }
  });

  it("carries bodies bigger than one frame both ways, and streamed answers", async () => {
    const { linkDevice } = setup();
    const { home } = linkDevice();
    const big = Uint8Array.from({ length: MAX_CHUNK * 3 + 17 }, (_, index) => index & 0xff);
    const echoed = await home.fetch("https://mac.invalid/api/echo", { method: "POST", body: big });
    expect(echoed.status).toBe(201);
    expect(echoed.headers.get("x-length")).toBe(String(big.length));
    expect(new Uint8Array(await echoed.arrayBuffer())).toEqual(big);

    const streamed = await home.fetch("https://mac.invalid/api/stream");
    expect(await streamed.text()).toBe("part one, part two");
  });

  it("carries WebSockets, text and binary, with the subprotocol", async () => {
    const { linkDevice } = setup();
    const { home } = linkDevice();
    const socket = new home.WebSocket("wss://mac.invalid/ws?wsTicket=abc", ["t3-rpc"]);
    socket.binaryType = "arraybuffer";
    const opened = new Promise((resolve) =>
      socket.addEventListener("open", resolve, { once: true }),
    );
    await opened;
    expect(socket.protocol).toBe("t3-rpc");
    const messages: Array<unknown> = [];
    const two = new Promise<void>((resolve) => {
      socket.addEventListener("message", (event: { data: unknown }) => {
        messages.push(event.data);
        if (messages.length === 2) resolve();
      });
    });
    const large = "x".repeat(MAX_CHUNK * 2 + 5);
    socket.send(large);
    socket.send(Uint8Array.of(1, 2, 3));
    await two;
    expect(messages[0]).toBe(`echo:${large}`);
    expect(new Uint8Array(messages[1] as ArrayBuffer)).toEqual(Uint8Array.of(1, 2, 3));

    const refused = new home.WebSocket("wss://mac.invalid/elsewhere");
    const closed = await new Promise<{ code: number }>((resolve) => {
      refused.addEventListener("close", resolve);
    });
    expect(closed.code).toBe(4401);
  });

  it("refuses a device whose record names another Mac's key", async () => {
    const { linkDevice } = setup();
    const { home, statuses } = linkDevice({
      hostNoiseKey: toBase64Url(generateKeyPair().publicKey),
    });
    await expect(home.fetch("https://mac.invalid/api/whoami")).rejects.toThrow(TypeError);
    expect(statuses).toContain("refused");
  });

  it("refuses a second device that copies a pass but has its own key", async () => {
    const { linkDevice, events } = setup();
    const first = linkDevice();
    await first.home.fetch("https://mac.invalid/api/whoami");
    const thief = linkDevice({
      deviceRelayId: first.saved().deviceRelayId,
      pass: first.saved().pass,
    });
    await expect(thief.home.fetch("https://mac.invalid/api/whoami")).rejects.toThrow(TypeError);
    expect(events.some((event) => event.type === "refused" && event.reason === "wrong key")).toBe(
      true,
    );
  });

  it("refuses a replayed first message", async () => {
    const { linkDevice, relay, host, waitForEvent } = setup();
    const { home } = linkDevice();
    await home.fetch("https://mac.invalid/api/whoami");
    const captured = relay.forwarded[0]!;
    host.onBinary(
      encodeHostFrame({
        kind: HostFrameKind.open,
        connectionId: "00000000000000aa",
        payload: utf8(JSON.stringify({ d: home.currentRecord.deviceRelayId })),
      }),
    );
    host.onBinary(
      encodeHostFrame({
        kind: HostFrameKind.data,
        connectionId: "00000000000000aa",
        payload: captured,
      }),
    );
    await waitForEvent((event) => event.type === "refused" && event.reason === "replay");
  });

  it("ends a removed device at once, and it stays refused", async () => {
    const { linkDevice, host, directory } = setup();
    const { home, deviceRelayId, statuses } = linkDevice();
    await home.fetch("https://mac.invalid/api/whoami");
    directory.removed.add(deviceRelayId);
    host.revoke(deviceRelayId, NOW_S + 3600);
    await expect(home.fetch("https://mac.invalid/api/whoami")).rejects.toThrow(TypeError);
    expect(statuses).toContain("refused");
  });

  it("carries on after the Mac reconnects to the relay, with a fresh channel", async () => {
    const { linkDevice, relay, noiseKey, signingKey, homeId, directory } = setup();
    const { home, statuses, waitForStatus } = linkDevice();
    expect((await home.fetch("https://mac.invalid/api/whoami")).status).toBe(200);
    const dropped = waitForStatus("offline");
    const restarted = new HostTunnel({
      homeId,
      noiseKey,
      signingKey,
      directory,
      handler: engine,
      transport: relay.hostTransport(),
      timers,
    });
    relay.attachHost(restarted);
    await dropped;
    const again = await home.fetch("https://mac.invalid/api/whoami");
    expect(again.status).toBe(200);
    expect(statuses.filter((status) => status === "ready").length).toBeGreaterThanOrEqual(2);
  });

  it("answers the tunnel's own control requests", async () => {
    const { linkDevice } = setup();
    const { home } = linkDevice();
    expect(await home.control({ op: "renew-pass" })).toEqual({ ok: true, op: "renew-pass" });
  });
});

describe("relay passes", () => {
  it("are checked against the home's own key, home and expiry", () => {
    const key = generateSigningKeyPair();
    const homeId = homeIdFor(key.publicKey);
    const deviceRelayId = newDeviceRelayId();
    const token = signPass(key, { homeId, deviceRelayId, expiresAt: 2000 });
    const hostPublicKey = toBase64Url(key.publicKey);
    expect(verifyPass({ token, homeId, hostPublicKey, nowSeconds: 1000 })?.deviceRelayId).toBe(
      deviceRelayId,
    );
    expect(verifyPass({ token, homeId, hostPublicKey, nowSeconds: 2000 })).toBeNull();
    const other = generateSigningKeyPair();
    expect(
      verifyPass({
        token,
        homeId: homeIdFor(other.publicKey),
        hostPublicKey: toBase64Url(other.publicKey),
        nowSeconds: 1000,
      }),
    ).toBeNull();
    const forged = signPass(other, { homeId, deviceRelayId, expiresAt: 2000 });
    expect(verifyPass({ token: forged, homeId, hostPublicKey, nowSeconds: 1000 })).toBeNull();
    const [body, signature] = token.split(".");
    const tampered = `${body!.slice(0, -2)}AA.${signature}`;
    expect(verifyPass({ token: tampered, homeId, hostPublicKey, nowSeconds: 1000 })).toBeNull();
  });

  it("a link whose pass names another home is not a relay link", () => {
    const { linkDevice } = setup({ passHome: homeIdFor(generateSigningKeyPair().publicKey) });
    expect(linkDevice().link).toBeNull();
  });
});

describe("the browser shim", () => {
  it("sends only the page's own engine paths through the relay", () => {
    const origin = "https://relay.example";
    expect(routesThroughRelay(new URL("https://relay.example/api/skycot/family"), origin)).toBe(
      true,
    );
    expect(routesThroughRelay(new URL("https://relay.example/ws"), origin)).toBe(true);
    expect(routesThroughRelay(new URL("https://relay.example/simple/assets/app.js"), origin)).toBe(
      false,
    );
    expect(routesThroughRelay(new URL("https://elsewhere.example/api/x"), origin)).toBe(false);
    expect(routesThroughRelay(new URL("https://relay.example/apis"), origin)).toBe(false);
  });

  it("routes fetch and WebSocket and can be removed again", async () => {
    const { linkDevice } = setup();
    const { home } = linkDevice();
    const originalFetch: typeof fetch = async () => new Response("page asset");
    const OriginalSocket = function () {
      throw new Error("A page asset socket was not expected here.");
    };
    const target = {
      fetch: originalFetch,
      WebSocket: OriginalSocket as unknown as typeof WebSocket,
      location: { origin: "https://relay.example", href: "https://relay.example/simple/" },
    };
    const restore = installRelayShim(target, home);
    expect(await (await target.fetch("/simple/app.js")).text()).toBe("page asset");
    const answer = await target.fetch("/api/whoami");
    expect(await answer.json()).toEqual({ cookie: null });
    const socket = new target.WebSocket("wss://relay.example/ws");
    expect(socket).toBeInstanceOf(home.WebSocket);
    socket.close();
    restore();
    expect(target.fetch).toBe(originalFetch);
    expect(fromUtf8(utf8("ok"))).toBe("ok");
  });
});
