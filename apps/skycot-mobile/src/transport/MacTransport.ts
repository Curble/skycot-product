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

export type TransportKind = "direct" | "relay";

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

/** The Mac on the home Wi-Fi or Tailscale, straight to its own address. */
export function directTransport(
  route: DirectRoute,
  options: {
    readonly fetch?: typeof fetch;
    readonly webSocket?: MacSocket["webSocketConstructor"];
  } = {},
): MacTransport {
  const doFetch = options.fetch ?? fetch;
  const base = route.httpBaseUrl.replace(/\/+$/u, "");
  const makeSocket =
    options.webSocket ??
    ((url: string, protocols?: string | Array<string>) => new WebSocket(url, protocols));

  const request = async (input: MacRequest): Promise<MacResponse> => {
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-t3-orchestration-protocol": ORCHESTRATION_PROTOCOL,
    };
    if (input.signedIn !== false && route.bearerToken !== null) {
      headers.authorization = `Bearer ${route.bearerToken}`;
    }
    let body: string | undefined;
    if (input.form !== undefined) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(input.form as Record<string, string>).toString();
    } else if (input.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(input.body);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await doFetch(withQuery(`${base}${input.path}`, input.query), {
        method: input.method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      });
    } catch (cause) {
      throw new MacUnreachableError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text().catch(() => "");
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: response.status, json };
  };

  return {
    kind: "direct",
    routeLabel: routeLabelFor(base),
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
      const wsBase = base.replace(/^http/u, "ws");
      return {
        url: withQuery(`${wsBase}/ws`, {
          wsTicket: ticket,
          orchestrationProtocol: ORCHESTRATION_PROTOCOL,
          clientSurface: "mobile",
        }),
        webSocketConstructor: makeSocket,
      };
    },
  };
}
