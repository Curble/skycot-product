// The Mac's end of the relay, independent of any runtime: it answers the relay's challenge,
// opens a sealed channel for each device connection the relay admits, and turns the frames
// inside into calls on a handler (the engine adapts that to its own HTTP and WebSocket API).
//
// The relay is never trusted here. A device connection is only served after:
//   1. its first message opens with this Mac's tunnel key (the device knew the key from the QR),
//   2. the Noise handshake proved the device holds the static key it claims,
//   3. the directory admits that key for that relay id, with a newer timestamp than the last,
//   4. and, per request, the handler checks the T3 sign-in the request carries.

import { fromUtf8, parseJsonObject, randomBytes, toBase64Url, utf8 } from "./encoding.ts";
import {
  chunkFrames,
  decodeDeviceHello,
  decodeMux,
  encodeMux,
  frameJson,
  jsonFrame,
  MAX_CHUNK,
  MuxFlag,
  MuxType,
  readRequestHead,
  readSocketOpen,
  type HeaderPairs,
  type MuxFrame,
  type RequestHead,
  type SocketOpen,
} from "./mux.ts";
import { readFirstMessage, SecureChannel, writeSecondMessage, type KeyPair } from "./noise.ts";
import { signHostChallenge, type SigningKeyPair } from "./pass.ts";
import {
  CONNECTION_ID_PATTERN,
  decodeHostFrame,
  encodeHostFrame,
  HostFrameKind,
  MAX_CONTROL_BYTES,
  prologueFor,
  type PushKind,
} from "./protocol.ts";

export type Admission =
  | {
      readonly ok: true;
      /** "linked": a known key; "pairing": a new device still exchanging its one-time code. */
      readonly mode: "linked" | "pairing";
    }
  | { readonly ok: false; readonly reason: string };

export interface DeviceDirectory {
  admit(input: {
    readonly deviceRelayId: string;
    /** The device's Noise static key (base64url), authenticated by the handshake. */
    readonly deviceKey: string;
    readonly timestamp: number;
  }): Promise<Admission>;
}

export interface TunnelContext {
  readonly connectionId: string;
  readonly deviceRelayId: string;
  readonly deviceKey: string;
  readonly mode: "linked" | "pairing";
}

export interface TunnelResponse {
  readonly status: number;
  readonly headers: HeaderPairs;
  readonly body: Uint8Array | AsyncIterable<Uint8Array>;
}

export interface SocketPeer {
  message(data: string | Uint8Array): void;
  close(code: number, reason: string): void;
}

export interface SocketHandle {
  readonly protocol: string;
  send(data: string | Uint8Array): void;
  close(code: number, reason: string): void;
}

export interface TunnelHandler {
  request(
    context: TunnelContext,
    head: RequestHead,
    body: Uint8Array,
    signal: AbortSignal,
  ): Promise<TunnelResponse>;
  socket(
    context: TunnelContext,
    open: SocketOpen,
    peer: SocketPeer,
  ): Promise<SocketHandle | { readonly refused: TunnelResponse }>;
  control(context: TunnelContext, request: Record<string, unknown>): Promise<unknown>;
  /** A device connection ended (its sockets are already closed). */
  closed?(context: TunnelContext): void;
}

export interface HostTransport {
  sendText(text: string): void;
  sendBinary(bytes: Uint8Array): void;
}

export interface Timers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type HostEvent =
  | { readonly type: "ready" }
  | { readonly type: "refused"; readonly deviceRelayId: string; readonly reason: string }
  | { readonly type: "channel-open"; readonly context: TunnelContext }
  | { readonly type: "channel-closed"; readonly connectionId: string }
  | { readonly type: "relay-error"; readonly message: string };

const MAX_REQUEST_BODY = 16 * 1024 * 1024;
const MAX_SOCKET_MESSAGE = 32 * 1024 * 1024;
const MAX_STREAMS_PER_CHANNEL = 256;
const PUSH_TIMEOUT_MS = 15_000;

interface PendingRequest {
  readonly head: RequestHead;
  readonly chunks: Array<Uint8Array>;
  size: number;
  readonly abort: AbortController;
}

interface OpenSocket {
  handle: SocketHandle | null;
  readonly partial: Array<Uint8Array>;
  partialSize: number;
  closed: boolean;
}

interface Channel {
  readonly connectionId: string;
  readonly deviceRelayId: string;
  state: "handshake" | "admitting" | "open" | "closed";
  secure: SecureChannel | null;
  context: TunnelContext | null;
  readonly queued: Array<Uint8Array>;
  readonly requests: Map<number, PendingRequest>;
  readonly sockets: Map<number, OpenSocket>;
}

const concat = (chunks: ReadonlyArray<Uint8Array>, size: number) => {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

export interface HostTunnelOptions {
  readonly homeId: string;
  readonly noiseKey: KeyPair;
  readonly signingKey: SigningKeyPair;
  readonly directory: DeviceDirectory;
  readonly handler: TunnelHandler;
  readonly transport: HostTransport;
  readonly timers: Timers;
  readonly onEvent?: (event: HostEvent) => void;
}

export class HostTunnel {
  private readonly channels = new Map<string, Channel>();
  private readonly pushes = new Map<
    string,
    { resolve: (result: { ok: boolean; reason?: string }) => void; timer: unknown }
  >();
  private ready = false;

  private readonly options: HostTunnelOptions;

  constructor(options: HostTunnelOptions) {
    this.options = options;
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Device relay ids with an open channel right now. */
  connectedDevices(): ReadonlyArray<string> {
    return [...this.channels.values()]
      .filter((channel) => channel.state === "open")
      .map((channel) => channel.deviceRelayId);
  }

  onText(text: string): void {
    if (text.length > MAX_CONTROL_BYTES) return;
    const message = parseJsonObject(text);
    if (message === null) return;
    switch (message["t"]) {
      case "challenge": {
        const nonce = message["nonce"];
        if (typeof nonce !== "string" || nonce.length > 128) return;
        this.options.transport.sendText(
          JSON.stringify({
            t: "hello",
            publicKey: toBase64Url(this.options.signingKey.publicKey),
            signature: signHostChallenge(this.options.signingKey, this.options.homeId, nonce),
          }),
        );
        return;
      }
      case "ready":
        this.ready = true;
        this.options.onEvent?.({ type: "ready" });
        return;
      case "push-result": {
        const id = message["id"];
        const pending = typeof id === "string" ? this.pushes.get(id) : undefined;
        if (pending === undefined) return;
        this.pushes.delete(id as string);
        this.options.timers.clearTimeout(pending.timer);
        const reason = message["reason"];
        pending.resolve({
          ok: message["ok"] === true,
          ...(typeof reason === "string" ? { reason } : {}),
        });
        return;
      }
      case "error": {
        const text = message["message"];
        this.options.onEvent?.({
          type: "relay-error",
          message: typeof text === "string" ? text : "The relay refused this Mac.",
        });
        return;
      }
      default:
        return;
    }
  }

  onBinary(bytes: Uint8Array): void {
    const frame = decodeHostFrame(bytes);
    if (frame === null || !CONNECTION_ID_PATTERN.test(frame.connectionId)) return;
    switch (frame.kind) {
      case HostFrameKind.open: {
        const body = parseJsonObject(safeUtf8(frame.payload) ?? "");
        const deviceRelayId = body?.["d"];
        if (typeof deviceRelayId !== "string" || this.channels.has(frame.connectionId)) return;
        this.channels.set(frame.connectionId, {
          connectionId: frame.connectionId,
          deviceRelayId,
          state: "handshake",
          secure: null,
          context: null,
          queued: [],
          requests: new Map(),
          sockets: new Map(),
        });
        return;
      }
      case HostFrameKind.data: {
        const channel = this.channels.get(frame.connectionId);
        if (channel === undefined) return;
        this.onSealed(channel, frame.payload.slice());
        return;
      }
      case HostFrameKind.close: {
        const channel = this.channels.get(frame.connectionId);
        if (channel !== undefined) this.teardown(channel, false);
        return;
      }
    }
  }

  /** The relay socket dropped: every channel is gone with it. */
  onDisconnected(): void {
    this.ready = false;
    for (const channel of this.channels.values()) this.teardown(channel, false);
    for (const [id, pending] of this.pushes) {
      this.options.timers.clearTimeout(pending.timer);
      pending.resolve({ ok: false, reason: "The relay connection dropped." });
      this.pushes.delete(id);
    }
  }

  /** Ends every channel of one device now (it was removed on the Mac). */
  closeDevice(deviceRelayId: string): void {
    for (const channel of this.channels.values()) {
      if (channel.deviceRelayId === deviceRelayId) this.teardown(channel, true);
    }
  }

  /** Asks the relay to refuse a device's pass from now until `untilSeconds`. */
  revoke(deviceRelayId: string, untilSeconds: number): void {
    this.closeDevice(deviceRelayId);
    if (!this.ready) return;
    this.options.transport.sendText(
      JSON.stringify({ t: "revoke", deviceRelayId, until: untilSeconds }),
    );
  }

  /** A content-free notification through the relay. */
  push(input: {
    readonly ref: string;
    readonly kind: PushKind;
    readonly sealed?: string;
  }): Promise<{ readonly ok: boolean; readonly reason?: string }> {
    if (!this.ready) return Promise.resolve({ ok: false, reason: "Not connected to the relay." });
    const id = toBase64Url(randomBytes(9));
    return new Promise((resolve) => {
      const timer = this.options.timers.setTimeout(() => {
        this.pushes.delete(id);
        resolve({ ok: false, reason: "The relay did not answer." });
      }, PUSH_TIMEOUT_MS);
      this.pushes.set(id, { resolve, timer });
      this.options.transport.sendText(
        JSON.stringify({
          t: "push",
          id,
          ref: input.ref,
          kind: input.kind,
          ...(input.sealed === undefined ? {} : { sealed: input.sealed }),
        }),
      );
    });
  }

  private onSealed(channel: Channel, sealed: Uint8Array): void {
    if (channel.state === "closed") return;
    if (channel.state === "handshake") {
      channel.state = "admitting";
      void this.handshake(channel, sealed);
      return;
    }
    if (channel.state === "admitting") {
      // The device waits for the Mac's answer before sending more; anything early is held.
      if (channel.queued.length < 64) channel.queued.push(sealed);
      else this.teardown(channel, true);
      return;
    }
    let plaintext: Uint8Array;
    try {
      plaintext = channel.secure!.open(sealed);
    } catch {
      // Tampered, replayed or reordered: the channel cannot be trusted any more.
      this.teardown(channel, true);
      return;
    }
    const frame = decodeMux(plaintext);
    if (frame === null) {
      this.teardown(channel, true);
      return;
    }
    this.onFrame(channel, frame);
  }

  private async handshake(channel: Channel, message: Uint8Array): Promise<void> {
    const prologue = prologueFor(this.options.homeId);
    let first: ReturnType<typeof readFirstMessage>;
    try {
      first = readFirstMessage({ s: this.options.noiseKey, prologue, message });
    } catch {
      this.refuse(channel, "The device did not seal its hello for this Mac.");
      return;
    }
    const hello = decodeDeviceHello(first.payload);
    if (hello === null || hello.deviceRelayId !== channel.deviceRelayId) {
      this.refuse(channel, "The device's hello does not match its relay pass.");
      return;
    }
    const deviceKey = toBase64Url(first.pending.rs);
    let admission: Admission;
    try {
      admission = await this.options.directory.admit({
        deviceRelayId: hello.deviceRelayId,
        deviceKey,
        timestamp: hello.timestamp,
      });
    } catch {
      admission = { ok: false, reason: "The Mac could not check this device." };
    }
    if (channel.state === "closed") return;
    if (!admission.ok) {
      this.refuse(channel, admission.reason);
      return;
    }
    const second = writeSecondMessage(first.pending, utf8(JSON.stringify({ v: 1 })));
    channel.secure = new SecureChannel(second);
    channel.context = {
      connectionId: channel.connectionId,
      deviceRelayId: channel.deviceRelayId,
      deviceKey,
      mode: admission.mode,
    };
    channel.state = "open";
    this.options.transport.sendBinary(
      encodeHostFrame({
        kind: HostFrameKind.data,
        connectionId: channel.connectionId,
        payload: second.message,
      }),
    );
    this.options.onEvent?.({ type: "channel-open", context: channel.context });
    for (const queued of channel.queued.splice(0)) this.onSealed(channel, queued);
  }

  private refuse(channel: Channel, reason: string): void {
    this.options.onEvent?.({ type: "refused", deviceRelayId: channel.deviceRelayId, reason });
    this.teardown(channel, true);
  }

  private send(channel: Channel, frame: MuxFrame): void {
    if (channel.state !== "open" || channel.secure === null) return;
    this.options.transport.sendBinary(
      encodeHostFrame({
        kind: HostFrameKind.data,
        connectionId: channel.connectionId,
        payload: channel.secure.seal(encodeMux(frame)),
      }),
    );
  }

  private onFrame(channel: Channel, frame: MuxFrame): void {
    const context = channel.context!;
    switch (frame.type) {
      case MuxType.requestHead: {
        const head = readRequestHead(frame);
        if (head === null || channel.requests.has(frame.stream)) {
          this.send(
            channel,
            jsonFrame(MuxType.responseError, frame.stream, { message: "Bad request." }),
          );
          return;
        }
        if (channel.requests.size + channel.sockets.size >= MAX_STREAMS_PER_CHANNEL) {
          this.send(
            channel,
            jsonFrame(MuxType.responseError, frame.stream, { message: "Too busy." }),
          );
          return;
        }
        const pending: PendingRequest = { head, chunks: [], size: 0, abort: new AbortController() };
        channel.requests.set(frame.stream, pending);
        if ((frame.flags & MuxFlag.fin) !== 0) this.dispatchRequest(channel, frame.stream, pending);
        return;
      }
      case MuxType.requestBody: {
        const pending = channel.requests.get(frame.stream);
        if (pending === undefined) return;
        pending.size += frame.body.length;
        if (pending.size > MAX_REQUEST_BODY) {
          channel.requests.delete(frame.stream);
          this.send(
            channel,
            jsonFrame(MuxType.responseError, frame.stream, { message: "Too large." }),
          );
          return;
        }
        pending.chunks.push(frame.body.slice());
        if ((frame.flags & MuxFlag.fin) !== 0) this.dispatchRequest(channel, frame.stream, pending);
        return;
      }
      case MuxType.cancel: {
        const pending = channel.requests.get(frame.stream);
        if (pending !== undefined) {
          pending.abort.abort();
          channel.requests.delete(frame.stream);
        }
        return;
      }
      case MuxType.socketOpen: {
        const open = readSocketOpen(frame);
        if (open === null || channel.sockets.has(frame.stream)) {
          this.send(
            channel,
            jsonFrame(MuxType.socketClose, frame.stream, { code: 1002, reason: "" }),
          );
          return;
        }
        const socket: OpenSocket = { handle: null, partial: [], partialSize: 0, closed: false };
        channel.sockets.set(frame.stream, socket);
        void this.openSocket(channel, context, frame.stream, open, socket);
        return;
      }
      case MuxType.socketData: {
        const socket = channel.sockets.get(frame.stream);
        if (socket === undefined || socket.handle === null || socket.closed) return;
        socket.partialSize += frame.body.length;
        if (socket.partialSize > MAX_SOCKET_MESSAGE) {
          this.closeSocket(channel, frame.stream, socket, 1009, "Message too big");
          return;
        }
        socket.partial.push(frame.body.slice());
        if ((frame.flags & MuxFlag.fin) === 0) return;
        const bytes = concat(socket.partial.splice(0), socket.partialSize);
        socket.partialSize = 0;
        if ((frame.flags & MuxFlag.binary) !== 0) socket.handle.send(bytes);
        else {
          const text = safeUtf8(bytes);
          if (text === null) this.closeSocket(channel, frame.stream, socket, 1007, "");
          else socket.handle.send(text);
        }
        return;
      }
      case MuxType.socketClose: {
        const socket = channel.sockets.get(frame.stream);
        if (socket === undefined) return;
        const body = frameJson(frame);
        const code = typeof body?.["code"] === "number" ? (body["code"] as number) : 1000;
        const reason = typeof body?.["reason"] === "string" ? (body["reason"] as string) : "";
        socket.closed = true;
        channel.sockets.delete(frame.stream);
        socket.handle?.close(validCloseCode(code), reason.slice(0, 120));
        return;
      }
      case MuxType.control: {
        const request = frameJson(frame);
        if (request === null) return;
        void this.options.handler.control(context, request).then(
          (reply) => this.send(channel, jsonFrame(MuxType.controlReply, frame.stream, reply ?? {})),
          () =>
            this.send(
              channel,
              jsonFrame(MuxType.controlReply, frame.stream, {
                error: "The Mac could not do that.",
              }),
            ),
        );
        return;
      }
      default:
        return;
    }
  }

  private dispatchRequest(channel: Channel, stream: number, pending: PendingRequest): void {
    const body = concat(pending.chunks, pending.size);
    pending.chunks.length = 0;
    void this.options.handler
      .request(channel.context!, pending.head, body, pending.abort.signal)
      .then(
        async (response) => {
          if (!channel.requests.has(stream)) return;
          this.send(
            channel,
            jsonFrame(MuxType.responseHead, stream, {
              status: response.status,
              headers: response.headers,
            }),
          );
          if (response.body instanceof Uint8Array) {
            for (const frame of chunkFrames(MuxType.responseBody, stream, response.body)) {
              this.send(channel, frame);
            }
          } else {
            for await (const chunk of response.body) {
              if (!channel.requests.has(stream)) return;
              for (let offset = 0; offset < chunk.length; offset += MAX_CHUNK) {
                this.send(channel, {
                  type: MuxType.responseBody,
                  stream,
                  flags: 0,
                  body: chunk.subarray(offset, Math.min(chunk.length, offset + MAX_CHUNK)),
                });
              }
            }
            this.send(channel, {
              type: MuxType.responseBody,
              stream,
              flags: MuxFlag.fin,
              body: new Uint8Array(0),
            });
          }
          channel.requests.delete(stream);
        },
        () => {
          if (!channel.requests.has(stream)) return;
          channel.requests.delete(stream);
          this.send(
            channel,
            jsonFrame(MuxType.responseError, stream, { message: "The Mac could not answer." }),
          );
        },
      );
  }

  private async openSocket(
    channel: Channel,
    context: TunnelContext,
    stream: number,
    open: SocketOpen,
    socket: OpenSocket,
  ): Promise<void> {
    const peer: SocketPeer = {
      message: (data) => {
        if (socket.closed) return;
        const binary = typeof data !== "string";
        const bytes = binary ? data : utf8(data);
        for (const frame of chunkFrames(
          MuxType.socketData,
          stream,
          bytes,
          binary ? MuxFlag.binary : 0,
        )) {
          this.send(channel, frame);
        }
      },
      close: (code, reason) => {
        if (socket.closed) return;
        socket.closed = true;
        channel.sockets.delete(stream);
        this.send(channel, jsonFrame(MuxType.socketClose, stream, { code, reason }));
      },
    };
    let result: Awaited<ReturnType<TunnelHandler["socket"]>>;
    try {
      result = await this.options.handler.socket(context, open, peer);
    } catch {
      result = {
        refused: { status: 502, headers: [], body: utf8("The Mac could not open that.") },
      };
    }
    if (socket.closed || channel.state === "closed") {
      if ("send" in result) result.close(1001, "");
      return;
    }
    if ("refused" in result) {
      socket.closed = true;
      channel.sockets.delete(stream);
      const body =
        result.refused.body instanceof Uint8Array ? (safeUtf8(result.refused.body) ?? "") : "";
      this.send(
        channel,
        jsonFrame(MuxType.socketClose, stream, {
          code: 4000 + Math.min(999, result.refused.status),
          reason: body.slice(0, 120),
        }),
      );
      return;
    }
    socket.handle = result;
    this.send(channel, jsonFrame(MuxType.socketAccept, stream, { protocol: result.protocol }));
  }

  private closeSocket(
    channel: Channel,
    stream: number,
    socket: OpenSocket,
    code: number,
    reason: string,
  ): void {
    socket.closed = true;
    channel.sockets.delete(stream);
    socket.handle?.close(code, reason);
    this.send(channel, jsonFrame(MuxType.socketClose, stream, { code, reason }));
  }

  private teardown(channel: Channel, tellRelay: boolean): void {
    if (channel.state === "closed") return;
    const wasOpen = channel.state === "open";
    channel.state = "closed";
    this.channels.delete(channel.connectionId);
    for (const pending of channel.requests.values()) pending.abort.abort();
    channel.requests.clear();
    for (const socket of channel.sockets.values()) {
      socket.closed = true;
      socket.handle?.close(1001, "Device went away");
    }
    channel.sockets.clear();
    if (tellRelay) {
      this.options.transport.sendBinary(
        encodeHostFrame({
          kind: HostFrameKind.close,
          connectionId: channel.connectionId,
          payload: utf8(JSON.stringify({ reason: "closed by the Mac" })),
        }),
      );
    }
    if (wasOpen && channel.context !== null) this.options.handler.closed?.(channel.context);
    this.options.onEvent?.({ type: "channel-closed", connectionId: channel.connectionId });
  }
}

function safeUtf8(bytes: Uint8Array): string | null {
  try {
    return fromUtf8(bytes);
  } catch {
    return null;
  }
}

/** Codes a WebSocket may be closed with by an application. */
export function validCloseCode(code: number): number {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;
}
