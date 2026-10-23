// An in-memory relay with the same rules as the Worker (infra/skycot-relay): passes checked
// against the home's key, one host per home, sealed bytes forwarded untouched. It also records
// every byte it forwarded, so tests can show it never held anything readable.

import type { WebSocketFactory, WebSocketLike } from "./client/home.ts";
import { parseJsonObject, randomBytes, toHex, utf8 } from "./encoding.ts";
import type { HostTransport } from "./host.ts";
import { verifyPass } from "./pass.ts";
import { CloseCode, decodeHostFrame, encodeHostFrame, HostFrameKind } from "./protocol.ts";

class FakeSocket implements WebSocketLike {
  binaryType = "blob";
  readyState = 0;
  private readonly listeners = new Map<string, Array<(event: never) => void>>();
  connectionId: string | null = null;
  deviceRelayId: string | null = null;

  readonly relay: MemoryRelay;
  readonly homeId: string;

  constructor(relay: MemoryRelay, homeId: string) {
    this.relay = relay;
    this.homeId = homeId;
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open", {});
    });
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? [])
      (listener as (event: unknown) => void)(event);
  }

  send(data: string | Uint8Array): void {
    if (this.readyState !== 1) return;
    this.relay.fromDevice(this, data);
  }

  close(code = 1000, reason = ""): void {
    this.relay.deviceClosed(this);
    this.deliverClose(code, reason);
  }

  deliver(data: string | Uint8Array): void {
    if (this.readyState !== 1) return;
    const payload =
      typeof data === "string"
        ? data
        : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    queueMicrotask(() => this.emit("message", { data: payload }));
  }

  deliverClose(code: number, reason: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    queueMicrotask(() => this.emit("close", { code, reason }));
  }
}

export class MemoryRelay {
  readonly forwarded: Array<Uint8Array> = [];
  private host: { onBinary(bytes: Uint8Array): void; onText(text: string): void } | null = null;
  private readonly devices = new Map<string, FakeSocket>();
  private readonly revoked = new Set<string>();

  readonly homeId: string;
  private readonly nowSeconds: () => number;

  constructor(homeId: string, nowSeconds: () => number = () => Math.floor(Date.now() / 1000)) {
    this.homeId = homeId;
    this.nowSeconds = nowSeconds;
  }

  /** The factory a RelayHome is given in place of `new WebSocket`. */
  readonly connect: WebSocketFactory = (url) => {
    const homeId = new URL(url).pathname.split("/")[3] ?? "";
    return new FakeSocket(this, homeId);
  };

  /** Attaches a host tunnel; returns the transport it should be built with. */
  hostTransport(): HostTransport {
    return {
      sendText: (text) => {
        const message = parseJsonObject(text);
        if (message?.["t"] === "revoke" && typeof message["deviceRelayId"] === "string") {
          this.revoked.add(message["deviceRelayId"]);
        }
      },
      sendBinary: (bytes) => {
        const frame = decodeHostFrame(bytes);
        if (frame === null) return;
        const device = this.devices.get(frame.connectionId);
        if (device === undefined) return;
        if (frame.kind === HostFrameKind.data) {
          this.forwarded.push(frame.payload.slice());
          device.deliver(frame.payload.slice());
        } else if (frame.kind === HostFrameKind.close) {
          this.devices.delete(frame.connectionId);
          device.deliverClose(CloseCode.revoked, "Closed by the Mac.");
        }
      },
    };
  }

  attachHost(host: { onBinary(bytes: Uint8Array): void; onText(text: string): void }): void {
    this.host = host;
    host.onText(JSON.stringify({ t: "ready" }));
    for (const device of this.devices.values())
      device.deliver(JSON.stringify({ t: "status", mac: true }));
  }

  fromDevice(socket: FakeSocket, data: string | Uint8Array): void {
    if (typeof data === "string") {
      const message = parseJsonObject(data);
      if (message?.["t"] !== "hello" || socket.connectionId !== null) return;
      const pass = verifyPass({
        token: String(message["pass"]),
        homeId: socket.homeId,
        hostPublicKey: String(message["hostKey"]),
        nowSeconds: this.nowSeconds(),
      });
      if (pass === null || socket.homeId !== this.homeId || this.revoked.has(pass.deviceRelayId)) {
        socket.deliverClose(CloseCode.unauthorized, "This pass is not valid.");
        return;
      }
      socket.connectionId = toHex(randomBytes(8));
      socket.deviceRelayId = pass.deviceRelayId;
      this.devices.set(socket.connectionId, socket);
      this.host?.onBinary(
        encodeHostFrame({
          kind: HostFrameKind.open,
          connectionId: socket.connectionId,
          payload: utf8(JSON.stringify({ d: pass.deviceRelayId })),
        }),
      );
      socket.deliver(JSON.stringify({ t: "status", mac: this.host !== null }));
      return;
    }
    if (socket.connectionId === null) return;
    this.forwarded.push(data.slice());
    this.host?.onBinary(
      encodeHostFrame({
        kind: HostFrameKind.data,
        connectionId: socket.connectionId,
        payload: data,
      }),
    );
  }

  deviceClosed(socket: FakeSocket): void {
    if (socket.connectionId === null) return;
    this.devices.delete(socket.connectionId);
    this.host?.onBinary(
      encodeHostFrame({
        kind: HostFrameKind.close,
        connectionId: socket.connectionId,
        payload: utf8("{}"),
      }),
    );
  }

  /** Everything forwarded, as one Latin-1 string, for "never saw plaintext" checks. */
  forwardedText(): string {
    return this.forwarded.map((bytes) => new TextDecoder("latin1").decode(bytes)).join("\n");
  }
}
