/**
 * How the app reaches a family's Mac.
 *
 * Every call the app makes goes through a `MacTransport`: plain requests (the Family routes, the
 * conversation lists) and the live socket the engine takes commands on. Today there is one
 * kind, `direct`: the Mac's own address on the home Wi-Fi or Tailscale, exactly as Phase 1
 * allows. SKYCOT Relay (Phase 2) plugs in as a second kind that carries the same requests and
 * the same socket end to end, sealed, without the screens changing. The relay is never a judge:
 * the Mac's session (the bearer token below) stays the device's only sign-in, whichever way the
 * bytes travel (docs/nondev/WHO-IS-WHO.md, "What Phases 2 to 4 must keep").
 */

// "sample" is the built-in sample family (src/sample): no network at all.
export type TransportKind = "direct" | "relay" | "sample";

export interface MacRequest {
  readonly method: "GET" | "POST";
  /** A path on the engine, starting with "/". */
  readonly path: string;
  readonly query?: Readonly<Record<string, string | undefined>>;
  /** JSON body. */
  readonly body?: unknown;
  /** Form body (the token exchange). */
  readonly form?: Readonly<Record<string, string>>;
  /** Send the device's sign-in. False only for the link exchange and the Mac's description. */
  readonly signedIn?: boolean;
}

export interface MacResponse {
  readonly status: number;
  /** The parsed JSON body, or null when there was none. */
  readonly json: unknown;
  // nondev-seam: skycot-fridge-card-mobile
  /** The body as text, only when it was not JSON (a fridge card is an SVG picture). */
  readonly text?: string;
}

/** A WebSocket the engine's command channel runs over, as `effect/socket` wants it. */
export interface MacSocket {
  readonly url: string;
  readonly webSocketConstructor: (url: string, protocols?: string | Array<string>) => WebSocket;
}

export interface MacTransport {
  readonly kind: TransportKind;
  /** Words for the screens: "Home Wi-Fi", "Tailscale", "SKYCOT Relay". */
  readonly routeLabel: string;
  request(input: MacRequest): Promise<MacResponse>;
  /** Opens the command channel: a fresh one-use ticket, then the socket's address. */
  socket(): Promise<MacSocket>;
}

/** Thrown when the Mac doesn't answer at all (asleep, off the Wi-Fi). */
export class MacUnreachableError extends Error {
  override readonly name = "MacUnreachableError";
}

export const ORCHESTRATION_PROTOCOL = "2";
const REQUEST_TIMEOUT_MS = 15_000;

/** Where a Mac answers directly, and the device's sign-in there. */
export interface DirectRoute {
  /** "http://192.168.1.20:3773", no trailing slash. */
  readonly httpBaseUrl: string;
  readonly bearerToken: string | null;
}

export function routeLabelFor(httpBaseUrl: string): string {
  let host = "";
  try {
    host = new URL(httpBaseUrl).hostname;
  } catch {
    return "Home Wi-Fi";
  }
  if (host.endsWith(".ts.net") || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./u.test(host)) {
    return "Tailscale";
  }
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") return "This Mac";
  return "Home Wi-Fi";
}

function withQuery(url: string, query: MacRequest["query"]): string {
  if (query === undefined) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, value);
  }
  const text = params.toString();
  return text.length === 0 ? url : `${url}?${text}`;
}

interface FetchRoute {
  readonly kind: TransportKind;
  readonly routeLabel: string;
  /** Where requests go: the Mac's own address, or the tunnel's placeholder origin. */
  readonly base: string;
  readonly bearerToken: string | null;
  readonly fetch: typeof fetch;
  readonly webSocket: MacSocket["webSocketConstructor"];
  /** Bodies as bytes: the relay's tunnel reads them without the platform's Blob reader. */
  readonly bytesBody: boolean;
  /**
   * The tunnel reads only a socket address's path and query, and React Native's URL class finds
   * the path of http addresses only, so through the relay the socket keeps the http scheme.
   */
  readonly socketScheme: "ws" | "http";
}

/** T3's HTTP API and its ticketed WebSocket over any fetch: the Mac's own, or the tunnel's. */
function fetchTransport(route: FetchRoute): MacTransport {
  const request = async (input: MacRequest): Promise<MacResponse> => {
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-t3-orchestration-protocol": ORCHESTRATION_PROTOCOL,
    };
    if (input.signedIn !== false && route.bearerToken !== null) {
      headers.authorization = `Bearer ${route.bearerToken}`;
    }
    let text: string | undefined;
    if (input.form !== undefined) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      text = new URLSearchParams(input.form as Record<string, string>).toString();
    } else if (input.body !== undefined) {
      headers["content-type"] = "application/json";
      text = JSON.stringify(input.body);
    }
    const body =
      text === undefined ? undefined : route.bytesBody ? new TextEncoder().encode(text) : text;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await route.fetch(withQuery(`${route.base}${input.path}`, input.query), {
        method: input.method,
        headers,
        credentials: "omit",
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      });
    } catch (cause) {
      throw new MacUnreachableError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      clearTimeout(timer);
    }
    const answer = await response.text().catch(() => "");
    let json: unknown = null;
    if (answer.length > 0) {
      try {
        json = JSON.parse(answer);
      } catch {
        json = null;
      }
    }
    return {
      status: response.status,
      json,
      ...(json === null && answer.length > 0 ? { text: answer } : {}),
    };
  };

  return {
    kind: route.kind,
    routeLabel: route.routeLabel,
    request,
    socket: async () => {
      const answer = await request({ method: "POST", path: "/api/auth/websocket-ticket" });
      const ticket =
        typeof answer.json === "object" && answer.json !== null
          ? (answer.json as Record<string, unknown>).ticket
          : undefined;
      if (answer.status !== 200 || typeof ticket !== "string") {
        throw new MacUnreachableError(`The Mac refused the live connection (${answer.status}).`);
      }
      const wsBase = route.socketScheme === "ws" ? route.base.replace(/^http/u, "ws") : route.base;
      return {
        url: withQuery(`${wsBase}/ws`, {
          wsTicket: ticket,
          orchestrationProtocol: ORCHESTRATION_PROTOCOL,
          clientSurface: "mobile",
        }),
        webSocketConstructor: route.webSocket,
      };
    },
  };
}

/** The Mac on the home Wi-Fi or Tailscale, straight to its own address. */
export function directTransport(
  route: DirectRoute,
  options: {
    readonly fetch?: typeof fetch;
    readonly webSocket?: MacSocket["webSocketConstructor"];
  } = {},
): MacTransport {
  const base = route.httpBaseUrl.replace(/\/+$/u, "");
  return fetchTransport({
    kind: "direct",
    routeLabel: routeLabelFor(base),
    base,
    bearerToken: route.bearerToken,
    fetch: options.fetch ?? ((input, init) => fetch(input, init)),
    webSocket:
      options.webSocket ??
      ((url: string, protocols?: string | Array<string>) => new WebSocket(url, protocols)),
    bytesBody: false,
    socketScheme: "ws",
  });
}

/**
 * The same Mac through SKYCOT Relay's sealed tunnel (packages/skycot-relay, RelayHome): the
 * device's own sign-in, T3's own API, sealed on this device for the Mac's key and opened only
 * on the Mac. The relay passes bytes along and can't read them (docs/nondev/RELAY.md).
 */
export interface RelayTunnel {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  readonly WebSocket: new (url: string, protocols?: string | ReadonlyArray<string>) => unknown;
}

/** Only the path and query are carried; the origin is a placeholder the tunnel ignores. */
const TUNNEL_ORIGIN = "http://home.skycot.invalid";

export function relayTransport(tunnel: RelayTunnel, bearerToken: string | null): MacTransport {
  return fetchTransport({
    kind: "relay",
    routeLabel: "SKYCOT Relay",
    base: TUNNEL_ORIGIN,
    bearerToken,
    fetch: (input, init) => tunnel.fetch(String(input), init),
    webSocket: (url, protocols) => new tunnel.WebSocket(url, protocols) as WebSocket,
    bytesBody: true,
    socketScheme: "http",
  });
}

/**
 * Several ways to one Mac, in order of preference: the first that answers is used and kept
 * until it stops answering, then the next is tried. Only "the Mac didn't answer" moves on; an
 * answer of any kind (a refusal too) is the Mac's and is returned as it is.
 */
export function failoverTransport(ways: ReadonlyArray<MacTransport>): MacTransport {
  if (ways.length === 0) throw new Error("A Mac needs at least one way to reach it.");
  let current = 0;
  const attempt = async <A>(run: (way: MacTransport) => Promise<A>): Promise<A> => {
    let lastError: unknown = null;
    for (let step = 0; step < ways.length; step += 1) {
      const index = (current + step) % ways.length;
      try {
        const result = await run(ways[index]!);
        current = index;
        return result;
      } catch (cause) {
        if (!(cause instanceof MacUnreachableError)) throw cause;
        lastError = cause;
      }
    }
    throw lastError;
  };
  return {
    get kind() {
      return ways[current]!.kind;
    },
    get routeLabel() {
      return ways[current]!.routeLabel;
    },
    request: (input) => attempt((way) => way.request(input)),
    socket: () => attempt((way) => way.socket()),
  };
}
