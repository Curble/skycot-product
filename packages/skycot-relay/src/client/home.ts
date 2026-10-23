// A linked device's way to its home Mac through SKYCOT Relay, with the same API as talking to
// the Mac directly: `home.fetch` behaves like `fetch` and `home.WebSocket` like `WebSocket`, so
// T3's shared connection layer (packages/client-runtime) and SKYCOT's own screens use it without
// knowing a relay is there. Nothing here needs a browser: React Native (Phase 3) gives it its own
// WebSocket and storage, and several homes are simply several `RelayHome`s ("Several Macs").
//
// Everything the device sends is sealed for the Mac's key from the QR code (noise.ts) before it
// reaches the relay. The Mac's session cookie is kept in the home's record (cookies.ts) because
// the browser's own jar never sees the Mac's address.

import {
  fromBase64Url,
  fromUtf8,
  parseJsonObject,
  randomBytes,
  toBase64Url,
  utf8,
} from "../encoding.ts";
import type { RelayLink } from "../link.ts";
import {
  chunkFrames,
  decodeMux,
  encodeDeviceHello,
  encodeMux,
  frameJson,
  jsonFrame,
  MuxFlag,
  MuxType,
  readResponseHead,
  type MuxFrame,
  type ResponseHead,
} from "../mux.ts";
import {
  generateKeyPair,
  keyPairFromSecret,
  readSecondMessage,
  SecureChannel,
  writeFirstMessage,
  type InitiatorPending,
} from "../noise.ts";
import { readPass } from "../pass.ts";
import {
  CloseCode,
  devicePath,
  prologueFor,
  type ApnsEnvironment,
  type PushTokenType,
} from "../protocol.ts";
import { applySetCookie, cookieHeader, type CookieRecord } from "./cookies.ts";

/** Everything a device keeps about one home Mac. Its keys are credentials: store it as such. */
export interface HomeRecord {
  readonly homeId: string;
  readonly relayUrl: string;
  readonly hostSigningKey: string;
  readonly hostNoiseKey: string;
  readonly deviceRelayId: string;
  readonly pass: string;
  /** This device's own Noise key for this home (base64url secret). */
  readonly deviceSecretKey: string;
  readonly lastTimestamp: number;
  readonly cookies: CookieRecord;
  /** What the person called this Mac, for the list of homes. */
  readonly label: string | null;
}

export function newHomeRecord(link: RelayLink, label: string | null = null): HomeRecord {
  return {
    homeId: link.homeId,
    relayUrl: link.relayUrl,
    hostSigningKey: link.hostSigningKey,
    hostNoiseKey: link.hostNoiseKey,
    deviceRelayId: link.deviceRelayId,
    pass: link.pass,
    deviceSecretKey: toBase64Url(generateKeyPair().secretKey),
    lastTimestamp: 0,
    cookies: {},
    label,
  };
}

export type HomeStatus =
  | "idle"
  | "connecting"
  | "waiting-for-mac"
  | "ready"
  /** The Mac or the relay said no: removed, revoked, or a pass that ran out. */
  | "refused"
  | "offline";

export interface WebSocketLike {
  binaryType: string;
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface Timers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RelayHomeOptions {
  readonly record: HomeRecord;
  /** Called whenever the record changes (cookies, timestamp, a renewed pass). */
  readonly save: (record: HomeRecord) => void;
  readonly connect?: WebSocketFactory;
  readonly now?: () => number;
  readonly timers?: Timers;
  readonly onStatus?: (status: HomeStatus) => void;
  /** How long a call waits for the Mac before failing like an unreachable server. */
  readonly readyTimeoutMs?: number;
}

const RENEW_WHEN_SECONDS_LEFT = 7 * 24 * 60 * 60;
const DEFAULT_READY_TIMEOUT_MS = 20_000;

// Headers the tunnel sets itself or that mean something only on the hop to the relay.
const DROPPED_REQUEST_HEADERS = new Set([
  "host",
  "cookie",
  "connection",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "origin",
  "referer",
]);

interface RequestStream {
  readonly kind: "request";
  readonly resolve: (response: Response) => void;
  readonly reject: (error: unknown) => void;
  head: ResponseHead | null;
  readonly chunks: Array<Uint8Array>;
  size: number;
}
interface SocketStream {
  readonly kind: "socket";
  readonly socket: RelayWebSocketBase;
  readonly partial: Array<Uint8Array>;
  partialSize: number;
}
interface ControlStream {
  readonly kind: "control";
  readonly resolve: (reply: Record<string, unknown>) => void;
  readonly reject: (error: unknown) => void;
}
type Stream = RequestStream | SocketStream | ControlStream;

const networkError = (detail: string) => new TypeError(`Failed to fetch: ${detail}`);

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

export class RelayHome {
  private record: HomeRecord;
  private status: HomeStatus = "idle";
  private socket: WebSocketLike | null = null;
  private pending: InitiatorPending | null = null;
  private channel: SecureChannel | null = null;
  private nextStream = 1;
  private readonly streams = new Map<number, Stream>();
  private readonly waiters = new Set<{
    resolve: () => void;
    reject: (error: unknown) => void;
    timer: unknown;
  }>();
  private readonly relayReplies = new Map<string, (message: Record<string, unknown>) => void>();
  private readonly now: () => number;
  private readonly timers: Timers;
  /** `WebSocket`-compatible class whose sockets travel through this home's tunnel. */
  readonly WebSocket: RelayWebSocketClass;

  private readonly options: RelayHomeOptions;

  constructor(options: RelayHomeOptions) {
    this.options = options;
    this.record = options.record;
    this.now = options.now ?? (() => Date.now());
    this.timers = options.timers ?? {
      setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.WebSocket = makeWebSocketClass(this);
  }

  get homeId(): string {
    return this.record.homeId;
  }

  get currentStatus(): HomeStatus {
    return this.status;
  }

  get currentRecord(): HomeRecord {
    return this.record;
  }

  /** `fetch`, carried to the home Mac. Only the path and query of the URL are used. */
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const body = hasBody ? new Uint8Array(await request.arrayBuffer()) : new Uint8Array(0);
    const headers: Array<readonly [string, string]> = [];
    request.headers.forEach((value, name) => {
      if (!DROPPED_REQUEST_HEADERS.has(name.toLowerCase()))
        headers.push([name.toLowerCase(), value]);
    });
    if (request.credentials !== "omit") {
      const cookie = cookieHeader(this.record.cookies, this.now());
      if (cookie !== null) headers.push(["cookie", cookie]);
    }
    if (request.signal?.aborted) throw abortError();
    await this.ensureReady();
    if (this.channel === null) throw networkError("SKYCOT Relay closed the connection");
    const stream = this.allocateStream();
    return new Promise<Response>((resolve, reject) => {
      const entry: RequestStream = {
        kind: "request",
        resolve,
        reject,
        head: null,
        chunks: [],
        size: 0,
      };
      this.streams.set(stream, entry);
      request.signal?.addEventListener(
        "abort",
        () => {
          if (this.streams.get(stream) !== entry) return;
          this.streams.delete(stream);
          this.sendFrame({ type: MuxType.cancel, stream, flags: 0, body: new Uint8Array(0) });
          reject(abortError());
        },
        { once: true },
      );
      this.sendFrame(
        jsonFrame(
          MuxType.requestHead,
          stream,
          { method: request.method, path: url.pathname + url.search, headers },
          body.length === 0 ? MuxFlag.fin : 0,
        ),
      );
      if (body.length > 0)
        for (const frame of chunkFrames(MuxType.requestBody, stream, body)) this.sendFrame(frame);
    });
  }

  /** A request to the Mac's tunnel itself (not the T3 API). */
  async control(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ensureReady();
    if (this.channel === null) throw networkError("SKYCOT Relay closed the connection");
    const stream = this.allocateStream();
    return new Promise((resolve, reject) => {
      this.streams.set(stream, { kind: "control", resolve, reject });
      this.sendFrame(jsonFrame(MuxType.control, stream, request));
    });
  }

  /**
   * Phase 3 (the iOS app): hands Apple's push token to the relay, which seals it into a
   * reference only the relay can open, and gives that reference to the Mac. The Mac never sees
   * the token; the relay never learns which person it belongs to.
   */
  async registerPush(input: {
    readonly token: string;
    readonly type: PushTokenType;
    readonly environment: ApnsEnvironment;
  }): Promise<boolean> {
    await this.ensureReady();
    const id = toBase64Url(randomBytes(9));
    const reply = await new Promise<Record<string, unknown>>((resolve) => {
      this.relayReplies.set(id, resolve);
      this.socket?.send(JSON.stringify({ t: "push-register", id, ...input }));
    });
    const ref = reply["ref"];
    if (typeof ref !== "string") return false;
    const answer = await this.control({ op: "push-ref", ref, type: input.type });
    return answer["ok"] === true;
  }

  /** Closes the tunnel; the next call opens it again. */
  close(): void {
    this.drop("idle", "Closed on this device.");
    this.setStatus("idle");
  }

  private setStatus(status: HomeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus?.(status);
  }

  private save(record: HomeRecord): void {
    this.record = record;
    this.options.save(record);
  }

  private allocateStream(): number {
    const stream = this.nextStream;
    this.nextStream = this.nextStream >= 0x7ffffffd ? 1 : this.nextStream + 2;
    return stream;
  }

  ensureReady(): Promise<void> {
    if (this.status === "ready") return Promise.resolve();
    if (this.socket === null) this.open();
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: this.timers.setTimeout(() => {
          this.waiters.delete(waiter);
          reject(networkError("the Mac did not answer through SKYCOT Relay"));
        }, this.options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS),
      };
      this.waiters.add(waiter);
    });
  }

  private settleWaiters(error: unknown | null): void {
    for (const waiter of [...this.waiters]) {
      this.timers.clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      if (error === null) waiter.resolve();
      else waiter.reject(error);
    }
  }

  private open(): void {
    this.setStatus("connecting");
    const relay = new URL(this.record.relayUrl);
    relay.protocol = relay.protocol === "https:" ? "wss:" : "ws:";
    relay.pathname = devicePath(this.record.homeId);
    const socket = (this.options.connect ?? defaultConnect)(relay.toString());
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      if (this.socket !== socket) return;
      socket.send(
        JSON.stringify({ t: "hello", pass: this.record.pass, hostKey: this.record.hostSigningKey }),
      );
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      if (typeof event.data === "string") this.onRelayText(event.data);
      else if (event.data instanceof ArrayBuffer) this.onSealed(new Uint8Array(event.data));
      else if (ArrayBuffer.isView(event.data)) {
        const view = event.data;
        this.onSealed(new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice());
      }
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      const refused =
        event.code === CloseCode.unauthorized ||
        event.code === CloseCode.revoked ||
        event.code === CloseCode.notFound;
      this.drop(
        refused ? "refused" : "offline",
        event.reason || "SKYCOT Relay closed the connection.",
      );
    };
    socket.onerror = () => undefined;
  }

  /** Ends the channel and everything on it. */
  private drop(status: HomeStatus, reason: string): void {
    const socket = this.socket;
    this.socket = null;
    this.pending = null;
    this.channel = null;
    if (socket !== null) {
      socket.onclose = null;
      socket.onmessage = null;
      try {
        socket.close(1000, "");
      } catch {
        // Already closing.
      }
    }
    this.setStatus(status);
    const error = networkError(reason);
    for (const [stream, entry] of [...this.streams]) {
      this.streams.delete(stream);
      if (entry.kind === "socket") entry.socket.relayClosed(1006, reason, false);
      else entry.reject(error);
    }
    this.settleWaiters(error);
    for (const resolve of this.relayReplies.values()) resolve({});
    this.relayReplies.clear();
  }

  private onRelayText(text: string): void {
    const message = parseJsonObject(text);
    if (message === null) return;
    if (message["t"] === "status") {
      if (message["mac"] === true) {
        if (this.channel === null && this.pending === null) this.startHandshake();
      } else {
        // The Mac went away: its channel went with it. Wait for it to come back.
        this.pending = null;
        this.channel = null;
        this.setStatus("waiting-for-mac");
        const error = networkError("the Mac is not connected to SKYCOT Relay");
        for (const [stream, entry] of [...this.streams]) {
          this.streams.delete(stream);
          if (entry.kind === "socket") entry.socket.relayClosed(1006, "", false);
          else entry.reject(error);
        }
      }
      return;
    }
    if (message["t"] === "push-ref") {
      const id = message["id"];
      const resolve = typeof id === "string" ? this.relayReplies.get(id) : undefined;
      if (resolve !== undefined) {
        this.relayReplies.delete(id as string);
        resolve(message);
      }
    }
  }

  private startHandshake(): void {
    const secret = fromBase64Url(this.record.deviceSecretKey);
    const hostKey = fromBase64Url(this.record.hostNoiseKey);
    if (secret === null || hostKey === null) {
      this.drop("refused", "This device's record for the Mac is damaged; link it again.");
      return;
    }
    const timestamp = Math.max(this.now(), this.record.lastTimestamp + 1);
    this.save({ ...this.record, lastTimestamp: timestamp });
    const first = writeFirstMessage({
      s: keyPairFromSecret(secret),
      rs: hostKey,
      prologue: prologueFor(this.record.homeId),
      payload: encodeDeviceHello({ deviceRelayId: this.record.deviceRelayId, timestamp }),
    });
    this.pending = first.pending;
    this.socket?.send(first.message);
  }

  private onSealed(bytes: Uint8Array): void {
    if (this.pending !== null) {
      try {
        const keys = readSecondMessage(this.pending, bytes);
        this.channel = new SecureChannel(keys);
      } catch {
        this.drop("refused", "The Mac's answer was not sealed with its key.");
        return;
      }
      this.pending = null;
      this.setStatus("ready");
      this.settleWaiters(null);
      void this.renewPassIfDue();
      return;
    }
    if (this.channel === null) return;
    let frame: MuxFrame | null;
    try {
      frame = decodeMux(this.channel.open(bytes));
    } catch {
      this.drop("offline", "A message from the Mac failed its seal check.");
      return;
    }
    if (frame !== null) this.onFrame(frame);
  }

  private onFrame(frame: MuxFrame): void {
    const entry = this.streams.get(frame.stream);
    if (entry === undefined) return;
    if (entry.kind === "control") {
      if (frame.type !== MuxType.controlReply) return;
      this.streams.delete(frame.stream);
      entry.resolve(frameJson(frame) ?? {});
      return;
    }
    if (entry.kind === "request") {
      if (frame.type === MuxType.responseHead) {
        entry.head = readResponseHead(frame);
        if (entry.head === null) {
          this.streams.delete(frame.stream);
          entry.reject(networkError("the Mac's answer was not understood"));
        }
      } else if (frame.type === MuxType.responseBody && entry.head !== null) {
        entry.chunks.push(frame.body.slice());
        entry.size += frame.body.length;
        if ((frame.flags & MuxFlag.fin) !== 0) {
          this.streams.delete(frame.stream);
          entry.resolve(this.toResponse(entry.head, concat(entry.chunks, entry.size)));
        }
      } else if (frame.type === MuxType.responseError) {
        this.streams.delete(frame.stream);
        const message = frameJson(frame)?.["message"];
        entry.reject(networkError(typeof message === "string" ? message : "the Mac refused"));
      }
      return;
    }
    const { socket } = entry;
    if (frame.type === MuxType.socketAccept) {
      const protocol = frameJson(frame)?.["protocol"];
      socket.relayOpened(typeof protocol === "string" ? protocol : "");
    } else if (frame.type === MuxType.socketData) {
      entry.partial.push(frame.body.slice());
      entry.partialSize += frame.body.length;
      if ((frame.flags & MuxFlag.fin) === 0) return;
      const bytes = concat(entry.partial.splice(0), entry.partialSize);
      entry.partialSize = 0;
      if ((frame.flags & MuxFlag.binary) !== 0) socket.relayMessage(bytes);
      else socket.relayMessage(fromUtf8(bytes));
    } else if (frame.type === MuxType.socketClose) {
      this.streams.delete(frame.stream);
      const body = frameJson(frame);
      const code = typeof body?.["code"] === "number" ? (body["code"] as number) : 1005;
      const reason = typeof body?.["reason"] === "string" ? (body["reason"] as string) : "";
      socket.relayClosed(code, reason, code === 1000);
    }
  }

  private toResponse(head: ResponseHead, body: Uint8Array): Response {
    const headers = new Headers();
    const setCookies: Array<string> = [];
    for (const [name, value] of head.headers) {
      if (name === "set-cookie") setCookies.push(value);
      else if (
        name !== "content-length" &&
        name !== "transfer-encoding" &&
        name !== "content-encoding"
      ) {
        headers.append(name, value);
      }
    }
    if (setCookies.length > 0) {
      this.save({
        ...this.record,
        cookies: applySetCookie(this.record.cookies, setCookies, this.now()),
      });
    }
    return new Response(NULL_BODY_STATUSES.has(head.status) ? null : (body as BodyInit), {
      status: head.status,
      headers,
    });
  }

  private sendFrame(frame: MuxFrame): void {
    if (this.channel === null || this.socket === null) return;
    this.socket.send(this.channel.seal(encodeMux(frame)));
  }

  private async renewPassIfDue(): Promise<void> {
    const pass = readPass(this.record.pass);
    if (pass === null || pass.expiresAt - this.now() / 1000 > RENEW_WHEN_SECONDS_LEFT) return;
    const reply = await this.control({ op: "renew-pass" }).catch(
      () => ({}) as Record<string, unknown>,
    );
    const renewed = reply["pass"];
    if (
      typeof renewed === "string" &&
      readPass(renewed)?.deviceRelayId === this.record.deviceRelayId
    ) {
      this.save({ ...this.record, pass: renewed });
    }
  }

  /** Used by the WebSocket class. */
  openSocket(socket: RelayWebSocketBase, path: string, protocols: ReadonlyArray<string>): void {
    void this.ensureReady().then(
      () => {
        if (socket.readyState !== 0) return;
        if (this.channel === null) {
          socket.relayClosed(1006, "", false);
          return;
        }
        const stream = this.allocateStream();
        socket.stream = stream;
        this.streams.set(stream, { kind: "socket", socket, partial: [], partialSize: 0 });
        const headers: Array<readonly [string, string]> = [];
        const cookie = cookieHeader(this.record.cookies, this.now());
        if (cookie !== null) headers.push(["cookie", cookie]);
        this.sendFrame(jsonFrame(MuxType.socketOpen, stream, { path, protocols, headers }));
      },
      () => socket.relayClosed(1006, "", false),
    );
  }

  socketSend(socket: RelayWebSocketBase, data: string | Uint8Array): void {
    if (socket.stream === null || !this.streams.has(socket.stream)) return;
    const binary = typeof data !== "string";
    for (const frame of chunkFrames(
      MuxType.socketData,
      socket.stream,
      binary ? data : utf8(data),
      binary ? MuxFlag.binary : 0,
    )) {
      this.sendFrame(frame);
    }
  }

  socketClose(socket: RelayWebSocketBase, code: number, reason: string): void {
    if (socket.stream === null) return;
    if (this.streams.delete(socket.stream)) {
      this.sendFrame(jsonFrame(MuxType.socketClose, socket.stream, { code, reason }));
    }
  }
}

const defaultConnect: WebSocketFactory = (url) => {
  const Constructor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  if (Constructor === undefined) throw new Error("This device has no WebSocket.");
  return new Constructor(url);
};

function concat(chunks: ReadonlyArray<Uint8Array>, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

type Listener = (event: never) => void;

/** The WebSocket surface browsers, Effect's Socket and React Native code rely on. */
export abstract class RelayWebSocketBase {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = 0;
  protocol = "";
  readonly extensions = "";
  readonly bufferedAmount = 0;
  binaryType: "blob" | "arraybuffer" = "blob";
  readonly url: string;
  stream: number | null = null;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose:
    | ((event: {
        readonly code: number;
        readonly reason: string;
        readonly wasClean: boolean;
      }) => void)
    | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private readonly listeners = new Map<string, Set<{ listener: Listener; once: boolean }>>();

  private readonly home: RelayHome;

  protected constructor(
    home: RelayHome,
    url: string | URL,
    protocols?: string | ReadonlyArray<string>,
  ) {
    this.home = home;
    const parsed = new URL(String(url));
    this.url = parsed.toString();
    const list =
      protocols === undefined ? [] : typeof protocols === "string" ? [protocols] : [...protocols];
    home.openSocket(this, parsed.pathname + parsed.search, list);
  }

  addEventListener(
    type: string,
    listener: Listener,
    options?: boolean | { readonly once?: boolean },
  ): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add({ listener, once: typeof options === "object" && options.once === true });
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type);
    if (set === undefined) return;
    for (const entry of set) if (entry.listener === listener) set.delete(entry);
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.readyState === 0)
      throw new Error("InvalidStateError: the socket is still connecting.");
    if (this.readyState !== 1) return;
    if (typeof data === "string") this.home.socketSend(this, data);
    else if (data instanceof ArrayBuffer) this.home.socketSend(this, new Uint8Array(data));
    else this.home.socketSend(this, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    this.home.socketClose(this, code, reason);
    this.relayClosed(code, reason, true);
  }

  private emit(type: string, event: Record<string, unknown>): void {
    const full = { type, target: this, currentTarget: this, ...event };
    const handler = this[`on${type}` as "onopen"];
    if (typeof handler === "function") handler.call(this, full);
    const set = this.listeners.get(type);
    if (set === undefined) return;
    for (const entry of [...set]) {
      if (entry.once) set.delete(entry);
      (entry.listener as (event: unknown) => void).call(this, full);
    }
  }

  relayOpened(protocol: string): void {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.protocol = protocol;
    queueMicrotask(() => this.emit("open", {}));
  }

  relayMessage(data: string | Uint8Array): void {
    if (this.readyState !== 1) return;
    const payload =
      typeof data === "string"
        ? data
        : this.binaryType === "arraybuffer" || typeof Blob === "undefined"
          ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
          : new Blob([data as BlobPart]);
    queueMicrotask(() => this.emit("message", { data: payload }));
  }

  relayClosed(code: number, reason: string, wasClean: boolean): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    queueMicrotask(() => {
      if (!wasClean) this.emit("error", {});
      this.emit("close", { code, reason, wasClean });
    });
  }
}

export type RelayWebSocketClass = {
  new (url: string | URL, protocols?: string | ReadonlyArray<string>): RelayWebSocketBase;
  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSING: 2;
  readonly CLOSED: 3;
};

function makeWebSocketClass(home: RelayHome): RelayWebSocketClass {
  return class RelayWebSocket extends RelayWebSocketBase {
    constructor(url: string | URL, protocols?: string | ReadonlyArray<string>) {
      super(home, url, protocols);
    }
  };
}
