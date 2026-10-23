// What the Mac does with a request that arrived through SKYCOT Relay: the same thing it does
// with one from the home network. The request goes to the engine's own HTTP and WebSocket
// server on this Mac, carrying the device's own T3 sign-in, so T3's scopes and every Phase 1
// rule (SkycotFamilyGate, SkycotFamilyHttp.layerApiGate, the visibility filters) judge it
// exactly as they judge a local one. The relay never becomes a judge.
//
// What this adds on top, before anything reaches the engine:
//   - a relay connection only ever carries the sign-in of the device it was linked for: a
//     request with any other session (the Mac's own, another device's) is refused, and a sign-in
//     made through it for another device is revoked on the spot;
//   - without a sign-in, only the few public routes pairing needs are carried;
//   - only the engine's API paths, never its web pages, and never MCP (that is for agents).
//
// Plain promise code around Node's fetch and WebSocket client: the engine's Effect service
// (SkycotRelay.ts) owns its lifetime and hands it what it needs as functions.
// @effect-diagnostics globalFetch:off globalTimers:off globalDate:off

import type { RequestHead, SocketOpen } from "@t3tools/skycot-relay/mux";
import type {
  SocketHandle,
  SocketPeer,
  TunnelContext,
  TunnelHandler,
  TunnelResponse,
} from "@t3tools/skycot-relay/host";

export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly subject: string;
}

export interface TunnelDependencies {
  /** `http://127.0.0.1:<port>`: the engine's own server. */
  readonly loopbackOrigin: string;
  /** Checks the sign-in a request carries, without changing anything. */
  readonly authenticate: (input: {
    readonly path: string;
    readonly headers: ReadonlyArray<readonly [string, string]>;
    readonly upgrade: boolean;
  }) => Promise<AuthenticatedSession | null>;
  /** The Family device a relay id was linked for, while the profile still has it. */
  readonly familyDeviceFor: (deviceRelayId: string) => Promise<string | null>;
  /** The Family device a session's subject names (`skycot-family-device:<id>`), if any. */
  readonly familyDeviceOf: (subject: string) => string | null;
  readonly revokeSession: (sessionId: string) => Promise<void>;
  readonly control: (context: TunnelContext, request: Record<string, unknown>) => Promise<unknown>;
  readonly log: (event: string, fields: Record<string, unknown>) => void;
}

const ENGINE_PATH = /^\/(?:api|ws|oauth|\.well-known)(?:\/|$)/;
/** What a device may reach before it has a sign-in: what pairing needs, and nothing else. */
const PUBLIC_ROUTES = new Set([
  "GET /.well-known/t3/environment",
  "GET /api/auth/session",
  "POST /api/auth/browser-session",
  "POST /oauth/token",
]);
/** The routes that make a new sign-in; what they make is checked before it is handed over. */
const SIGN_IN_ROUTES = new Set(["POST /api/auth/browser-session", "POST /oauth/token"]);

// Headers that describe the hop, not the request, or that only the Mac may set.
const DROP_REQUEST = new Set([
  "host",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "transfer-encoding",
  "content-length",
  "proxy-authorization",
  "proxy-connection",
  "origin",
  "referer",
  "forwarded",
  "x-real-ip",
  "accept-encoding",
]);
const DROP_RESPONSE = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "content-encoding",
]);

const dropRequestHeader = (name: string) =>
  DROP_REQUEST.has(name) ||
  name.startsWith("x-forwarded-") ||
  name.startsWith("cf-") ||
  name.startsWith("sec-websocket-");

const pathnameOf = (path: string) => path.split("?")[0] ?? path;

const plain = (status: number, error: string, message: string): TunnelResponse => ({
  status,
  headers: [
    ["content-type", "application/json"],
    ["cache-control", "no-store"],
  ],
  body: new TextEncoder().encode(JSON.stringify({ error, message })),
});

const NOT_HERE = () => plain(404, "not-found", "That isn't available through SKYCOT Relay.");
const ONLY_THIS_DEVICE = () =>
  plain(403, "forbidden", "This connection only carries the device it was linked for.");
const SIGN_IN_FIRST = () => plain(401, "unauthenticated", "Sign in to SKYCOT again.");

function forwardHeaders(head: { readonly headers: ReadonlyArray<readonly [string, string]> }) {
  const headers: Array<[string, string]> = [];
  for (const [name, value] of head.headers) {
    if (!dropRequestHeader(name)) headers.push([name, value]);
  }
  // Compressing before sealing would let page content and cookies leak through sizes (BREACH).
  headers.push(["accept-encoding", "identity"]);
  return headers;
}

async function* bodyOf(response: Response): AsyncIterable<Uint8Array> {
  if (response.body === null) return;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** The new session a sign-in route answered with: its cookie, or its access token. */
async function newCredential(
  response: Response,
): Promise<{
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly body: Uint8Array;
}> {
  const body = new Uint8Array(await response.arrayBuffer());
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]!.trim());
  const headers: Array<readonly [string, string]> = [];
  if (cookies.length > 0) headers.push(["cookie", cookies.join("; ")]);
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    const token =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)["access_token"]
        : undefined;
    if (typeof token === "string") headers.push(["authorization", `Bearer ${token}`]);
  } catch {
    // Not JSON: a cookie answer.
  }
  return { headers, body };
}

export function makeTunnelHandler(deps: TunnelDependencies): TunnelHandler {
  /** Whose request this is, and whether this connection may carry it. */
  const judge = async (
    context: TunnelContext,
    head: {
      readonly method: string;
      readonly path: string;
      readonly headers: ReadonlyArray<readonly [string, string]>;
    },
    upgrade: boolean,
  ): Promise<
    | { readonly ok: true; readonly familyDeviceId: string }
    | { readonly ok: false; readonly response: TunnelResponse }
  > => {
    const pathname = pathnameOf(head.path);
    if (!ENGINE_PATH.test(pathname)) return { ok: false, response: NOT_HERE() };
    const familyDeviceId = await deps.familyDeviceFor(context.deviceRelayId);
    if (familyDeviceId === null) return { ok: false, response: ONLY_THIS_DEVICE() };
    const session = await deps.authenticate({ path: head.path, headers: head.headers, upgrade });
    if (session === null) {
      return PUBLIC_ROUTES.has(`${head.method} ${pathname}`) && !upgrade
        ? { ok: true, familyDeviceId }
        : { ok: false, response: SIGN_IN_FIRST() };
    }
    if (deps.familyDeviceOf(session.subject) !== familyDeviceId) {
      deps.log("skycot-relay.foreign-session", { device: context.deviceRelayId.slice(0, 4) });
      return { ok: false, response: ONLY_THIS_DEVICE() };
    }
    return { ok: true, familyDeviceId };
  };

  return {
    async request(context, head: RequestHead, body, signal) {
      const verdict = await judge(context, head, false);
      if (!verdict.ok) return verdict.response;
      const route = `${head.method} ${pathnameOf(head.path)}`;
      const response = await fetch(`${deps.loopbackOrigin}${head.path}`, {
        method: head.method,
        headers: forwardHeaders(head),
        ...(head.method === "GET" || head.method === "HEAD" ? {} : { body }),
        redirect: "manual",
        signal,
      });
      const headers: Array<readonly [string, string]> = [];
      response.headers.forEach((value, name) => {
        if (name !== "set-cookie" && !DROP_RESPONSE.has(name)) headers.push([name, value]);
      });
      for (const cookie of response.headers.getSetCookie()) headers.push(["set-cookie", cookie]);

      if (SIGN_IN_ROUTES.has(route) && response.status === 200) {
        // A new sign-in made through this connection must be this connection's device.
        const made = await newCredential(response);
        const session =
          made.headers.length === 0
            ? null
            : await deps.authenticate({
                path: "/api/auth/session",
                headers: made.headers,
                upgrade: false,
              });
        if (session !== null && deps.familyDeviceOf(session.subject) !== verdict.familyDeviceId) {
          await deps.revokeSession(session.sessionId);
          deps.log("skycot-relay.foreign-sign-in-revoked", {
            device: context.deviceRelayId.slice(0, 4),
          });
          return ONLY_THIS_DEVICE();
        }
        if (session !== null)
          deps.log("skycot-relay.device-signed-in", { device: context.deviceRelayId.slice(0, 4) });
        return { status: response.status, headers, body: made.body };
      }
      return { status: response.status, headers, body: bodyOf(response) };
    },

    async socket(
      context,
      open: SocketOpen,
      peer: SocketPeer,
    ): Promise<SocketHandle | { readonly refused: TunnelResponse }> {
      const verdict = await judge(
        context,
        { method: "GET", path: open.path, headers: open.headers },
        true,
      );
      if (!verdict.ok) return { refused: verdict.response };
      const url = `${deps.loopbackOrigin.replace(/^http/, "ws")}${open.path}`;
      const headers = Object.fromEntries(
        forwardHeaders(open).filter(([name]) => name !== "accept-encoding"),
      );
      // Node's WebSocket client (undici) takes headers as an extension of the browser API.
      const NodeWebSocket = WebSocket as unknown as new (
        url: string,
        options: {
          readonly protocols?: ReadonlyArray<string>;
          readonly headers?: Record<string, string>;
        },
      ) => WebSocket;
      const local = new NodeWebSocket(url, { protocols: open.protocols, headers });
      local.binaryType = "arraybuffer";
      const opened = await new Promise<boolean>((resolve) => {
        local.addEventListener("open", () => resolve(true), { once: true });
        local.addEventListener("error", () => resolve(false), { once: true });
        local.addEventListener("close", () => resolve(false), { once: true });
      });
      if (!opened) return { refused: plain(502, "unavailable", "The Mac could not open that.") };
      local.addEventListener("message", (event) => {
        const data = event.data;
        if (typeof data === "string") peer.message(data);
        else if (data instanceof ArrayBuffer) peer.message(new Uint8Array(data));
      });
      local.addEventListener("close", (event) =>
        peer.close(event.code === 1005 ? 1000 : event.code, event.reason),
      );
      return {
        protocol: local.protocol,
        send: (data) => {
          if (local.readyState === 1) local.send(data);
        },
        close: (code, reason) => {
          try {
            local.close(code, reason);
          } catch {
            local.close();
          }
        },
      };
    },

    control: (context, request) => deps.control(context, request),
  };
}
