import { describe, expect, it, vi } from "vite-plus/test";

import { parseJsonObject, toBase64Url, utf8 } from "@t3tools/skycot-relay/encoding";
import {
  generateSigningKeyPair,
  homeIdFor,
  newDeviceRelayId,
  signHostChallenge,
  signPass,
} from "@t3tools/skycot-relay/pass";
import {
  CloseCode,
  decodeHostFrame,
  encodeHostFrame,
  HostFrameKind,
} from "@t3tools/skycot-relay/protocol";

import { LIMITS } from "./limits.ts";
import { openPushRef, sealPushRef } from "./push.ts";
import { Room, type RoomSocket } from "./room.ts";

class FakeSocket implements RoomSocket {
  attachment: unknown = null;
  readonly sent: Array<string | Uint8Array> = [];
  closed: { code: number; reason: string } | null = null;
  private readonly sockets: Set<FakeSocket>;
  constructor(sockets: Set<FakeSocket>) {
    this.sockets = sockets;
    sockets.add(this);
  }
  send(data: string | ArrayBuffer | Uint8Array) {
    if (this.closed) throw new Error("closed");
    this.sent.push(typeof data === "string" ? data : new Uint8Array(data as ArrayBuffer));
  }
  close(code = 1000, reason = "") {
    this.closed = { code, reason };
    this.sockets.delete(this);
  }
  serializeAttachment(value: unknown) {
    this.attachment = value;
  }
  deserializeAttachment() {
    return this.attachment;
  }
  texts() {
    return this.sent
      .filter((entry): entry is string => typeof entry === "string")
      .map((text) => parseJsonObject(text));
  }
  frames() {
    return this.sent
      .filter((entry): entry is Uint8Array => typeof entry !== "string")
      .map(decodeHostFrame);
  }
}

const PUSH_REF_KEY = toBase64Url(new Uint8Array(32).fill(7));

function setup(env: Record<string, string> = {}) {
  const sockets = new Set<FakeSocket>();
  const store = new Map<string, unknown>();
  let now = 1_000_000_000_000;
  const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const room = new Room(
    {
      sockets: () => [...sockets],
      storage: {
        get: async <T>(key: string) => store.get(key) as T | undefined,
        put: async (key, value) => void store.set(key, value),
        delete: async (key) => store.delete(key),
      },
      now: () => now,
      log: (event, fields) => logs.push({ event, fields }),
      debugFrames: false,
    },
    { PUSH_REF_KEY, ...env },
  );
  const key = generateSigningKeyPair();
  const homeId = homeIdFor(key.publicKey);

  const connectHost = async (signingKey = key) => {
    expect(room.admitConnection("host").ok).toBe(true);
    const socket = new FakeSocket(sockets);
    room.opened(socket, "host", homeId);
    const nonce = String(socket.texts()[0]?.["nonce"]);
    await room.message(
      socket,
      JSON.stringify({
        t: "hello",
        publicKey: toBase64Url(signingKey.publicKey),
        signature: signHostChallenge(signingKey, homeId, nonce),
      }),
    );
    return socket;
  };

  const connectDevice = async (deviceRelayId = newDeviceRelayId(), pass?: string) => {
    const socket = new FakeSocket(sockets);
    room.opened(socket, "device", homeId);
    await room.message(
      socket,
      JSON.stringify({
        t: "hello",
        pass:
          pass ??
          signPass(key, { homeId, deviceRelayId, expiresAt: Math.floor(now / 1000) + 3600 }),
        hostKey: toBase64Url(key.publicKey),
      }),
    );
    return socket;
  };

  return {
    room,
    sockets,
    store,
    logs,
    key,
    homeId,
    connectHost,
    connectDevice,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("a home on the relay", () => {
  it("lets only the home's own Mac be its host", async () => {
    const { connectHost } = setup();
    const host = await connectHost();
    expect(host.texts().at(-1)).toEqual({ t: "ready" });
    const impostor = await connectHost(generateSigningKeyPair());
    expect(impostor.closed?.code).toBe(CloseCode.unauthorized);
    expect(host.closed).toBeNull();
  });

  it("forwards sealed bytes both ways without changing them, naming the connection", async () => {
    const { room, connectHost, connectDevice } = setup();
    const host = await connectHost();
    const deviceRelayId = newDeviceRelayId();
    const device = await connectDevice(deviceRelayId);
    expect(device.texts().at(-1)).toEqual({ t: "status", mac: true });
    const open = host.frames().find((frame) => frame?.kind === HostFrameKind.open)!;
    expect(parseJsonObject(new TextDecoder().decode(open.payload))).toEqual({ d: deviceRelayId });

    const sealed = Uint8Array.from({ length: 300 }, (_, index) => (index * 13) & 0xff);
    await room.message(device, sealed);
    const forwarded = host.frames().find((frame) => frame?.kind === HostFrameKind.data)!;
    expect(forwarded.connectionId).toBe(open.connectionId);
    expect(forwarded.payload).toEqual(sealed);

    await room.message(
      host,
      encodeHostFrame({
        kind: HostFrameKind.data,
        connectionId: open.connectionId,
        payload: utf8("sealed answer"),
      }),
    );
    expect(device.sent.at(-1)).toEqual(utf8("sealed answer"));
  });

  it("refuses a pass for another home, a forged pass and an expired one", async () => {
    const { connectDevice, homeId, key, advance } = setup();
    const other = generateSigningKeyPair();
    const forged = signPass(other, {
      homeId,
      deviceRelayId: newDeviceRelayId(),
      expiresAt: 9_999_999_999,
    });
    expect((await connectDevice(undefined, forged)).closed?.code).toBe(CloseCode.unauthorized);
    expect((await connectDevice(undefined, "not-a-pass")).closed?.code).toBe(
      CloseCode.unauthorized,
    );
    const deviceRelayId = newDeviceRelayId();
    const pass = signPass(key, { homeId, deviceRelayId, expiresAt: 1_000_000_000 + 3600 });
    const device = await connectDevice(deviceRelayId, pass);
    expect(device.closed).toBeNull();
    advance(3601 * 1000);
    expect((await connectDevice(deviceRelayId, pass)).closed?.code).toBe(CloseCode.unauthorized);
  });

  it("tells waiting devices when their Mac arrives and leaves", async () => {
    const { room, connectHost, connectDevice } = setup();
    const device = await connectDevice();
    expect(device.texts().at(-1)).toEqual({ t: "status", mac: false });
    const host = await connectHost();
    expect(device.texts().at(-1)).toEqual({ t: "status", mac: true });
    expect(host.frames().some((frame) => frame?.kind === HostFrameKind.open)).toBe(true);
    // When the Mac goes (or reconnects), devices sealed with it start again on a new connection.
    host.close();
    room.closed(host);
    expect(device.closed?.code).toBe(CloseCode.macGone);
    const again = await connectDevice();
    expect(again.texts().at(-1)).toEqual({ t: "status", mac: false });
    await connectHost();
    expect(again.closed).toBeNull();
    expect(again.texts().at(-1)).toEqual({ t: "status", mac: true });
    await connectHost();
    expect(again.closed?.code).toBe(CloseCode.macGone);
  });

  it("refuses a removed device until its passes would have run out", async () => {
    const { room, connectHost, connectDevice, store } = setup();
    const host = await connectHost();
    const deviceRelayId = newDeviceRelayId();
    const device = await connectDevice(deviceRelayId);
    await room.message(host, JSON.stringify({ t: "revoke", deviceRelayId, until: 9_999_999_999 }));
    expect(device.closed?.code).toBe(CloseCode.revoked);
    expect(Object.keys(store.get("revoked") as object)).toEqual([deviceRelayId]);
    expect((await connectDevice(deviceRelayId)).closed?.code).toBe(CloseCode.revoked);
    expect((await connectDevice()).closed).toBeNull();
  });

  it("rate-limits a chatty device and new connections per home", async () => {
    const { room, connectHost, connectDevice } = setup();
    await connectHost();
    const device = await connectDevice();
    for (let index = 0; index < LIMITS.deviceFrames.burst + 1; index += 1) {
      if (device.closed) break;
      await room.message(device, Uint8Array.of(1));
    }
    expect(device.closed?.code).toBe(CloseCode.rateLimited);

    let refused = 0;
    for (let index = 0; index < LIMITS.homeConnects.burst + 5; index += 1) {
      if (!room.admitConnection("device").ok) refused += 1;
    }
    expect(refused).toBeGreaterThan(0);
  });

  it("refuses frames bigger than one sealed message", async () => {
    const { room, connectHost, connectDevice } = setup();
    await connectHost();
    const device = await connectDevice();
    await room.message(device, new Uint8Array(70_000));
    expect(device.closed?.code).toBe(CloseCode.tooBig);
  });

  it("keeps each device to a few connections, newest first", async () => {
    const { connectHost, connectDevice } = setup();
    await connectHost();
    const deviceRelayId = newDeviceRelayId();
    const sockets = [];
    for (let index = 0; index < LIMITS.connectionsPerDevice + 1; index += 1) {
      sockets.push(await connectDevice(deviceRelayId));
    }
    expect(sockets[0]!.closed?.code).toBe(CloseCode.replaced);
    expect(sockets.at(-1)!.closed).toBeNull();
  });

  it("closes a socket that never says who it is", () => {
    const { room, sockets, advance } = setup();
    const socket = new FakeSocket(sockets);
    room.opened(socket, "device", "x".repeat(32));
    advance(LIMITS.helloTimeoutMs + 1);
    room.admitConnection("device");
    expect(socket.closed?.code).toBe(CloseCode.unauthorized);
  });
});

async function apnsKey() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const base64 = Buffer.from(der).toString("base64");
  return {
    pem: `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`,
    publicKey: pair.publicKey,
  };
}

describe("notifications", () => {
  it("seal a push token so only this relay, for this home, can use it", async () => {
    const env = { PUSH_REF_KEY };
    const target = {
      token: "a".repeat(64),
      type: "alert" as const,
      environment: "production" as const,
    };
    const ref = await sealPushRef(env, "home-one", target);
    expect(ref).not.toContain("a".repeat(16));
    expect(await openPushRef(env, "home-one", ref!)).toEqual(target);
    expect(await openPushRef(env, "home-two", ref!)).toBeNull();
    expect(
      await openPushRef({ PUSH_REF_KEY: toBase64Url(new Uint8Array(32)) }, "home-one", ref!),
    ).toBeNull();
  });

  it("send only a fixed, content-free alert for the kind the Mac asked for", async () => {
    const { pem, publicKey } = await apnsKey();
    const { room, connectHost, connectDevice } = setup({
      APNS_TEAM_ID: "TEAM123456",
      APNS_KEY_ID: "KEY1234567",
      APNS_PRIVATE_KEY: pem,
      APNS_BUNDLE_ID: "com.skycot.app",
      APNS_ORIGIN: "https://apns.fake",
    });
    const host = await connectHost();
    const device = await connectDevice();
    await room.message(
      device,
      JSON.stringify({
        t: "push-register",
        id: "r1",
        token: "b".repeat(64),
        type: "alert",
        environment: "development",
      }),
    );
    const ref = String(device.texts().find((message) => message?.["t"] === "push-ref")?.["ref"]);

    const calls: Array<{ url: string; init: RequestInit }> = [];
    using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 200 });
    });
    await room.message(
      host,
      JSON.stringify({ t: "push", id: "p1", ref, kind: "needs-grown-up", sealed: "opaque" }),
    );
    expect(host.texts().at(-1)).toEqual({ t: "push-result", id: "p1", ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://apns.fake/3/device/${"b".repeat(64)}`);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["apns-push-type"]).toBe("alert");
    expect(headers["apns-topic"]).toBe("com.skycot.app");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      aps: {
        alert: { title: "SKYCOT", body: "SKYCOT needs a grown-up" },
        sound: "default",
        "mutable-content": 1,
        "thread-id": "needs-grown-up",
      },
      s: "opaque",
    });
    const [header, claims, signature] = headers["authorization"]!.replace("bearer ", "").split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "KEY1234567",
    });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())["iss"]).toBe("TEAM123456");
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      Buffer.from(signature!, "base64url"),
      utf8(`${header}.${claims}`),
    );
    expect(valid).toBe(true);

    await room.message(
      host,
      JSON.stringify({ t: "push", id: "p2", ref, kind: "tell-them-everything" }),
    );
    expect(host.texts().at(-1)).toEqual({
      t: "push-result",
      id: "p2",
      ok: false,
      reason: "bad-request",
    });
    await room.message(
      host,
      JSON.stringify({ t: "push", id: "p3", ref: "nonsense", kind: "finished" }),
    );
    expect(host.texts().at(-1)).toEqual({
      t: "push-result",
      id: "p3",
      ok: false,
      reason: "bad-ref",
    });
    expect(calls).toHaveLength(1);
  });

  it("stay off without Apple's key", async () => {
    const { room, connectHost } = setup();
    const host = await connectHost();
    const ref = await sealPushRef({ PUSH_REF_KEY }, "x", {
      token: "c".repeat(64),
      type: "alert",
      environment: "production",
    });
    await room.message(host, JSON.stringify({ t: "push", id: "p", ref, kind: "finished" }));
    expect(host.texts().at(-1)).toEqual({
      t: "push-result",
      id: "p",
      ok: false,
      reason: "not-configured",
    });
  });
});
