// One home on the relay: its Mac's socket and its devices' sockets, and the rules between them.
// Written against small interfaces so the same code runs in the Durable Object (worker.ts) and
// in Node tests. Every socket's role lives in its attachment, so the object can sleep between
// messages (Cloudflare's WebSocket hibernation) and wake up knowing who is who.
//
// What the room does with a frame from a device: checks the device was admitted with a valid
// pass, checks the rate limits, and hands the sealed bytes to the Mac with the device's
// connection id in front. It never opens them, and keeps nothing once they are passed on.

import {
  parseJsonObject,
  randomBytes,
  toBase64Url,
  toHex,
  utf8,
} from "@t3tools/skycot-relay/encoding";
import { verifyHostChallenge, verifyPass } from "@t3tools/skycot-relay/pass";
import {
  CloseCode,
  decodeHostFrame,
  encodeHostFrame,
  HostFrameKind,
  isPushKind,
  MAX_CONTROL_BYTES,
  MAX_FRAME_BYTES,
} from "@t3tools/skycot-relay/protocol";

import { BucketMap, LIMITS, TokenBucket } from "./limits.ts";
import { isPushToken, sealPushRef, sendPush, type PushEnv } from "./push.ts";

export type Attachment =
  | {
      readonly role: "pending-host";
      readonly homeId: string;
      readonly nonce: string;
      readonly at: number;
    }
  | { readonly role: "host"; readonly homeId: string; readonly at: number }
  | { readonly role: "pending-device"; readonly homeId: string; readonly at: number }
  | {
      readonly role: "device";
      readonly homeId: string;
      readonly at: number;
      readonly connectionId: string;
      readonly deviceRelayId: string;
    };

export interface RoomSocket {
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

export interface RoomStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface RoomHost {
  sockets(): ReadonlyArray<RoomSocket>;
  readonly storage: RoomStorage;
  now(): number;
  log(event: string, fields: Record<string, unknown>): void;
  /** Local debugging only: every forwarded frame, to show it was never readable. */
  readonly debugFrames: boolean;
}

export type RoomEnv = PushEnv;

const attachmentOf = (socket: RoomSocket): Attachment | null => {
  try {
    return (socket.deserializeAttachment() as Attachment | null) ?? null;
  } catch {
    return null;
  }
};

const safeClose = (socket: RoomSocket, code: number, reason: string) => {
  try {
    socket.close(code, reason);
  } catch {
    // Already closed.
  }
};

/** Closes a socket and forgets its role first, so its close event changes nothing more. */
const retire = (socket: RoomSocket, code: number, reason: string) => {
  try {
    socket.serializeAttachment(null);
  } catch {
    // Already gone.
  }
  safeClose(socket, code, reason);
};

const safeSend = (socket: RoomSocket, data: string | Uint8Array) => {
  try {
    socket.send(data);
  } catch {
    // The socket went away; its close event tidies up.
  }
};

const toBytes = (message: string | ArrayBuffer | Uint8Array) =>
  typeof message === "string"
    ? null
    : message instanceof Uint8Array
      ? message
      : new Uint8Array(message);

export class Room {
  private readonly host: RoomHost;
  private readonly env: RoomEnv;
  private readonly homeConnects: TokenBucket;
  private readonly hostConnects: TokenBucket;
  private readonly homeFrames: TokenBucket;
  private readonly homePushes: TokenBucket;
  private readonly deviceFrames = new BucketMap(
    LIMITS.deviceFrames.burst,
    LIMITS.deviceFrames.perSecond,
  );
  private readonly deviceBytes = new BucketMap(
    LIMITS.deviceBytes.burst,
    LIMITS.deviceBytes.perSecond,
  );
  private readonly refPushes = new BucketMap(LIMITS.refPushes.burst, LIMITS.refPushes.perSecond);
  private readonly registrations = new BucketMap(
    LIMITS.pushRegistrations.burst,
    LIMITS.pushRegistrations.perSecond,
  );

  constructor(host: RoomHost, env: RoomEnv) {
    this.host = host;
    this.env = env;
    const now = host.now();
    this.homeConnects = new TokenBucket(
      LIMITS.homeConnects.burst,
      LIMITS.homeConnects.perSecond,
      now,
    );
    this.hostConnects = new TokenBucket(
      LIMITS.hostConnects.burst,
      LIMITS.hostConnects.perSecond,
      now,
    );
    this.homeFrames = new TokenBucket(LIMITS.homeFrames.burst, LIMITS.homeFrames.perSecond, now);
    this.homePushes = new TokenBucket(LIMITS.homePushes.burst, LIMITS.homePushes.perSecond, now);
  }

  private all(): Array<{ socket: RoomSocket; attachment: Attachment }> {
    const out: Array<{ socket: RoomSocket; attachment: Attachment }> = [];
    for (const socket of this.host.sockets()) {
      const attachment = attachmentOf(socket);
      if (attachment !== null) out.push({ socket, attachment });
    }
    return out;
  }

  private hostSocket(): RoomSocket | null {
    return this.all().find((entry) => entry.attachment.role === "host")?.socket ?? null;
  }

  private devices(): Array<{
    socket: RoomSocket;
    attachment: Extract<Attachment, { role: "device" }>;
  }> {
    return this.all().filter(
      (
        entry,
      ): entry is { socket: RoomSocket; attachment: Extract<Attachment, { role: "device" }> } =>
        entry.attachment.role === "device",
    );
  }

  /** Whether a new connection may even be accepted (checked before the upgrade). */
  admitConnection(
    role: "host" | "device",
  ): { readonly ok: true } | { readonly ok: false; readonly status: number } {
    const now = this.host.now();
    this.sweepPending(now);
    if (role === "host")
      return this.hostConnects.take(now) ? { ok: true } : { ok: false, status: 429 };
    if (!this.homeConnects.take(now)) return { ok: false, status: 429 };
    const count = this.all().filter(
      (entry) => entry.attachment.role === "device" || entry.attachment.role === "pending-device",
    ).length;
    return count >= LIMITS.devicesPerHome ? { ok: false, status: 503 } : { ok: true };
  }

  /** A socket was just accepted. */
  opened(socket: RoomSocket, role: "host" | "device", homeId: string): void {
    const at = this.host.now();
    if (role === "host") {
      const nonce = toBase64Url(randomBytes(24));
      socket.serializeAttachment({ role: "pending-host", homeId, nonce, at } satisfies Attachment);
      safeSend(socket, JSON.stringify({ t: "challenge", nonce }));
    } else {
      socket.serializeAttachment({ role: "pending-device", homeId, at } satisfies Attachment);
    }
  }

  private sweepPending(now: number): void {
    for (const { socket, attachment } of this.all()) {
      if (
        (attachment.role === "pending-host" || attachment.role === "pending-device") &&
        now - attachment.at > LIMITS.helloTimeoutMs
      ) {
        safeClose(socket, CloseCode.unauthorized, "Say hello first.");
      }
    }
  }

  async message(socket: RoomSocket, message: string | ArrayBuffer | Uint8Array): Promise<void> {
    const attachment = attachmentOf(socket);
    if (attachment === null) {
      safeClose(socket, CloseCode.protocol, "Unknown connection.");
      return;
    }
    const bytes = toBytes(message);
    if (bytes !== null && bytes.length > MAX_FRAME_BYTES) {
      safeClose(socket, CloseCode.tooBig, "Frame too big.");
      return;
    }
    if (typeof message === "string" && message.length > MAX_CONTROL_BYTES) {
      safeClose(socket, CloseCode.tooBig, "Message too big.");
      return;
    }
    switch (attachment.role) {
      case "pending-host":
        return this.hostHello(socket, attachment, message);
      case "host":
        return bytes === null
          ? this.hostControl(attachment, message as string)
          : this.fromHost(bytes);
      case "pending-device":
        return this.deviceHello(socket, attachment, message);
      case "device":
        return bytes === null
          ? this.deviceControl(socket, attachment, message as string)
          : this.fromDevice(socket, attachment, bytes);
    }
  }

  private hostHello(
    socket: RoomSocket,
    attachment: Extract<Attachment, { role: "pending-host" }>,
    message: string | ArrayBuffer | Uint8Array,
  ): void {
    const hello = typeof message === "string" ? parseJsonObject(message) : null;
    const ok =
      hello !== null &&
      hello["t"] === "hello" &&
      typeof hello["publicKey"] === "string" &&
      typeof hello["signature"] === "string" &&
      verifyHostChallenge({
        homeId: attachment.homeId,
        nonce: attachment.nonce,
        publicKey: hello["publicKey"],
        signature: hello["signature"],
      });
    if (!ok) {
      this.host.log("host-refused", { home: tag(attachment.homeId) });
      safeClose(socket, CloseCode.unauthorized, "This is not the home's Mac.");
      return;
    }
    // A newer connection from the same Mac replaces the old one (a restart, a new network).
    for (const { socket: other, attachment: otherAttachment } of this.all()) {
      if (otherAttachment.role === "host" && other !== socket) {
        retire(other, CloseCode.replaced, "Replaced by a newer connection from the Mac.");
      }
    }
    socket.serializeAttachment({
      role: "host",
      homeId: attachment.homeId,
      at: this.host.now(),
    } satisfies Attachment);
    safeSend(socket, JSON.stringify({ t: "ready" }));
    const devices = this.devices();
    for (const device of devices) {
      safeSend(socket, openFrame(device.attachment.connectionId, device.attachment.deviceRelayId));
    }
    for (const device of devices)
      safeSend(device.socket, JSON.stringify({ t: "status", mac: true }));
    this.host.log("host-ready", { home: tag(attachment.homeId), devices: devices.length });
  }

  private async deviceHello(
    socket: RoomSocket,
    attachment: Extract<Attachment, { role: "pending-device" }>,
    message: string | ArrayBuffer | Uint8Array,
  ): Promise<void> {
    const hello = typeof message === "string" ? parseJsonObject(message) : null;
    const pass =
      hello !== null &&
      hello["t"] === "hello" &&
      typeof hello["pass"] === "string" &&
      typeof hello["hostKey"] === "string"
        ? verifyPass({
            token: hello["pass"],
            homeId: attachment.homeId,
            hostPublicKey: hello["hostKey"],
            nowSeconds: Math.floor(this.host.now() / 1000),
          })
        : null;
    if (pass === null) {
      this.host.log("device-refused", { home: tag(attachment.homeId), why: "pass" });
      safeClose(socket, CloseCode.unauthorized, "This device's relay pass is not valid.");
      return;
    }
    const revokedUntil = await this.host.storage.get<number>(`revoked:${pass.deviceRelayId}`);
    if (revokedUntil !== undefined && revokedUntil > this.host.now() / 1000) {
      this.host.log("device-refused", { home: tag(attachment.homeId), why: "revoked" });
      safeClose(socket, CloseCode.revoked, "This device was removed on the Mac.");
      return;
    }
    // One device, a few connections at most: the oldest gives way.
    const same = this.devices()
      .filter((entry) => entry.attachment.deviceRelayId === pass.deviceRelayId)
      .sort((left, right) => left.attachment.at - right.attachment.at);
    while (same.length >= LIMITS.connectionsPerDevice) {
      const oldest = same.shift()!;
      retire(oldest.socket, CloseCode.replaced, "Replaced by a newer connection.");
      this.notifyHostClosed(oldest.attachment.connectionId);
    }
    const connectionId = toHex(randomBytes(8));
    socket.serializeAttachment({
      role: "device",
      homeId: attachment.homeId,
      at: this.host.now(),
      connectionId,
      deviceRelayId: pass.deviceRelayId,
    } satisfies Attachment);
    const host = this.hostSocket();
    if (host !== null) safeSend(host, openFrame(connectionId, pass.deviceRelayId));
    safeSend(socket, JSON.stringify({ t: "status", mac: host !== null }));
    this.host.log("device-admitted", { home: tag(attachment.homeId), mac: host !== null });
  }

  private fromDevice(
    socket: RoomSocket,
    attachment: Extract<Attachment, { role: "device" }>,
    bytes: Uint8Array,
  ): void {
    const now = this.host.now();
    if (
      !this.deviceFrames.take(attachment.deviceRelayId, now) ||
      !this.deviceBytes.take(attachment.deviceRelayId, now, bytes.length) ||
      !this.homeFrames.take(now)
    ) {
      this.host.log("rate-limited", { home: tag(attachment.homeId), what: "frames" });
      retire(socket, CloseCode.rateLimited, "Too many messages; slow down.");
      this.notifyHostClosed(attachment.connectionId);
      return;
    }
    const host = this.hostSocket();
    if (host === null) return;
    if (this.host.debugFrames) {
      this.host.log("frame", { dir: "device->mac", bytes: bytes.length, b64: toBase64Url(bytes) });
    }
    safeSend(
      host,
      encodeHostFrame({
        kind: HostFrameKind.data,
        connectionId: attachment.connectionId,
        payload: bytes,
      }),
    );
  }

  private fromHost(bytes: Uint8Array): void {
    const frame = decodeHostFrame(bytes);
    if (frame === null) return;
    const device = this.devices().find(
      (entry) => entry.attachment.connectionId === frame.connectionId,
    );
    if (device === undefined) return;
    if (frame.kind === HostFrameKind.data) {
      if (this.host.debugFrames) {
        this.host.log("frame", {
          dir: "mac->device",
          bytes: frame.payload.length,
          b64: toBase64Url(frame.payload),
        });
      }
      safeSend(device.socket, frame.payload.slice());
    } else if (frame.kind === HostFrameKind.close) {
      retire(device.socket, CloseCode.revoked, "Closed by the Mac.");
    }
  }

  private notifyHostClosed(connectionId: string): void {
    const host = this.hostSocket();
    if (host === null) return;
    safeSend(
      host,
      encodeHostFrame({
        kind: HostFrameKind.close,
        connectionId,
        payload: utf8(JSON.stringify({ reason: "gone" })),
      }),
    );
  }

  private async hostControl(
    attachment: Extract<Attachment, { role: "host" }>,
    text: string,
  ): Promise<void> {
    const message = parseJsonObject(text);
    if (message === null) return;
    if (message["t"] === "revoke") {
      const deviceRelayId = message["deviceRelayId"];
      const until = message["until"];
      if (typeof deviceRelayId !== "string" || typeof until !== "number") return;
      // Passes last at most about a month, so a revocation never needs to outlive that.
      const capped = Math.min(until, Math.floor(this.host.now() / 1000) + 40 * 24 * 3600);
      await this.host.storage.put(`revoked:${deviceRelayId}`, capped);
      for (const device of this.devices()) {
        if (device.attachment.deviceRelayId === deviceRelayId) {
          retire(device.socket, CloseCode.revoked, "This device was removed on the Mac.");
          this.notifyHostClosed(device.attachment.connectionId);
        }
      }
      this.host.log("device-revoked", { home: tag(attachment.homeId) });
      return;
    }
    if (message["t"] === "push") {
      const { id, ref, kind, sealed } = message;
      if (typeof id !== "string" || id.length > 64) return;
      const reply = (ok: boolean, reason?: string) => {
        const host = this.hostSocket();
        if (host !== null) {
          safeSend(
            host,
            JSON.stringify({
              t: "push-result",
              id,
              ok,
              ...(reason === undefined ? {} : { reason }),
            }),
          );
        }
      };
      if (typeof ref !== "string" || !isPushKind(kind)) return reply(false, "bad-request");
      if (sealed !== undefined && (typeof sealed !== "string" || sealed.length > 2048)) {
        return reply(false, "bad-request");
      }
      const now = this.host.now();
      if (!this.homePushes.take(now) || !this.refPushes.take(ref, now))
        return reply(false, "rate-limited");
      const outcome = await sendPush({
        env: this.env,
        homeId: attachment.homeId,
        ref,
        kind,
        sealed: typeof sealed === "string" ? sealed : null,
        nowSeconds: Math.floor(now / 1000),
      });
      this.host.log("push", { home: tag(attachment.homeId), kind, ok: outcome.ok });
      return outcome.ok ? reply(true) : reply(false, outcome.reason);
    }
  }

  private async deviceControl(
    socket: RoomSocket,
    attachment: Extract<Attachment, { role: "device" }>,
    text: string,
  ): Promise<void> {
    const message = parseJsonObject(text);
    if (message === null || message["t"] !== "push-register") return;
    const { id, token, type, environment } = message;
    if (typeof id !== "string" || id.length > 64) return;
    const answer = (ref: string | null) =>
      safeSend(
        socket,
        JSON.stringify(ref === null ? { t: "push-ref", id } : { t: "push-ref", id, ref }),
      );
    if (
      typeof token !== "string" ||
      !isPushToken(token) ||
      (type !== "alert" && type !== "liveactivity") ||
      (environment !== "production" && environment !== "development") ||
      !this.registrations.take(attachment.deviceRelayId, this.host.now())
    ) {
      return answer(null);
    }
    answer(await sealPushRef(this.env, attachment.homeId, { token, type, environment }));
  }

  /** A socket closed or failed. */
  closed(socket: RoomSocket): void {
    const attachment = attachmentOf(socket);
    if (attachment === null) return;
    if (attachment.role === "host") {
      if (this.hostSocket() !== null && this.hostSocket() !== socket) return;
      for (const device of this.devices())
        safeSend(device.socket, JSON.stringify({ t: "status", mac: false }));
      this.host.log("host-gone", { home: tag(attachment.homeId) });
    } else if (attachment.role === "device") {
      this.notifyHostClosed(attachment.connectionId);
    }
    // Mark it so a late event for the same socket does nothing twice.
    try {
      socket.serializeAttachment(null);
    } catch {
      // Closed sockets may refuse; nothing to tidy.
    }
  }
}

const openFrame = (connectionId: string, deviceRelayId: string) =>
  encodeHostFrame({
    kind: HostFrameKind.open,
    connectionId,
    payload: utf8(JSON.stringify({ d: deviceRelayId })),
  });

/** Logs name a home by its first characters only. */
const tag = (homeId: string) => homeId.slice(0, 6);
