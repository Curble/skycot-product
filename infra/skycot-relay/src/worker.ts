// SKYCOT Relay, the Cloudflare Worker. Small on purpose: it routes each home to its own Durable
// Object (room.ts) and answers a health check. There are no accounts, no database and no stored
// messages; the only thing a home's object keeps on disk is which removed devices to refuse,
// until their passes would have run out anyway. See docs/nondev/RELAY.md.

import { HOME_ID_PATTERN } from "@t3tools/skycot-relay/pass";
import { RELAY_PROTOCOL_VERSION } from "@t3tools/skycot-relay/protocol";

import { Room, type RoomSocket } from "./room.ts";
import type { PushEnv } from "./push.ts";

export interface Env extends PushEnv {
  readonly HOMES: DurableObjectNamespace;
  /** Optional Workers Rate Limiting binding: new connections per network address. */
  readonly ADDRESS_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  /** "1" only on a local test relay: logs every forwarded frame to prove it is unreadable. */
  readonly RELAY_DEBUG_FRAMES?: string;
  readonly ASSETS?: Fetcher;
}

const ROUTE = /^\/v1\/homes\/([a-z2-7]{32})\/(host|device)$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" || url.pathname === "/v1") {
      return json({ ok: true, service: "skycot-relay", protocol: RELAY_PROTOCOL_VERSION });
    }
    const match = ROUTE.exec(url.pathname);
    if (match === null) {
      return env.ASSETS ? env.ASSETS.fetch(request) : json({ error: "not-found" }, 404);
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "websocket-required" }, 426);
    }
    const homeId = match[1]!;
    if (!HOME_ID_PATTERN.test(homeId)) return json({ error: "not-found" }, 404);
    if (env.ADDRESS_LIMITER !== undefined) {
      const address = request.headers.get("cf-connecting-ip") ?? "unknown";
      const { success } = await env.ADDRESS_LIMITER.limit({ key: address });
      if (!success) return json({ error: "rate-limited" }, 429);
    }
    const stub = env.HOMES.get(env.HOMES.idFromName(homeId));
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** One home. Sleeps between messages (WebSocket hibernation), so an idle family costs nothing. */
export class HomeRoom implements DurableObject {
  private readonly ctx: DurableObjectState;
  private readonly room: Room;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.room = new Room(
      {
        sockets: () => ctx.getWebSockets() as unknown as ReadonlyArray<RoomSocket>,
        storage: ctx.storage,
        now: () => Date.now(),
        log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
        debugFrames: env.RELAY_DEBUG_FRAMES === "1",
      },
      env,
    );
  }

  async fetch(request: Request): Promise<Response> {
    const match = ROUTE.exec(new URL(request.url).pathname);
    if (match === null) return json({ error: "not-found" }, 404);
    const homeId = match[1]!;
    const role = match[2] as "host" | "device";
    const admission = this.room.admitConnection(role);
    if (!admission.ok) {
      return json({ error: admission.status === 429 ? "rate-limited" : "full" }, admission.status);
    }
    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    this.room.opened(server as unknown as RoomSocket, role, homeId);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.room.message(socket as unknown as RoomSocket, message);
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    this.room.closed(socket as unknown as RoomSocket);
    try {
      socket.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed.
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    this.room.closed(socket as unknown as RoomSocket);
  }
}
