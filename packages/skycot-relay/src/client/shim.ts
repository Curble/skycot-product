// Browser only: makes a page that was not served by the Mac talk to its home Mac through the
// relay, without changing any of the code that calls `fetch` or `new WebSocket`. Calls to the
// page's own origin under the engine's API paths go through the tunnel; everything else (the
// page's own scripts and pictures, other sites) goes where it always went.
//
// Pictures and links (`<img src="/api/…">`) do not pass through `fetch`, so they cannot use the
// tunnel; screens that show engine files over the relay must fetch them first.

import type { RelayHome } from "./home.ts";

/** The engine's API, as the Vite dev proxy lists it (packages/shared/src/devProxy.ts). */
const ENGINE_PATH = /^\/(?:api|ws|oauth|\.well-known|mcp)(?:\/|$)/;

export function routesThroughRelay(url: URL, pageOrigin: string): boolean {
  return url.origin === pageOrigin && ENGINE_PATH.test(url.pathname);
}

interface ShimTarget {
  fetch: typeof fetch;
  WebSocket: typeof WebSocket;
  readonly location: { readonly origin: string; readonly href: string };
}

/** Installs the routing; returns a function that puts the originals back. */
export function installRelayShim(target: ShimTarget, home: RelayHome): () => void {
  const originalFetch = target.fetch;
  const OriginalWebSocket = target.WebSocket;
  const pageOrigin = target.location.origin;

  const relayFetch: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? String(input) : input.url,
      target.location.href,
    );
    if (!routesThroughRelay(url, pageOrigin)) return originalFetch.call(target, input, init);
    const request = typeof input === "string" || input instanceof URL ? url.toString() : input;
    return home.fetch(request, init);
  };

  const RelayAwareWebSocket = function (
    this: unknown,
    url: string | URL,
    protocols?: string | Array<string>,
  ) {
    const resolved = new URL(String(url), target.location.href);
    const asHttp = new URL(resolved.toString());
    asHttp.protocol = resolved.protocol === "wss:" ? "https:" : "http:";
    if (routesThroughRelay(asHttp, pageOrigin)) return new home.WebSocket(resolved, protocols);
    return new OriginalWebSocket(resolved, protocols);
  } as unknown as typeof WebSocket;
  Object.assign(RelayAwareWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  RelayAwareWebSocket.prototype = OriginalWebSocket.prototype;

  target.fetch = relayFetch;
  target.WebSocket = RelayAwareWebSocket;
  return () => {
    target.fetch = originalFetch;
    target.WebSocket = OriginalWebSocket;
  };
}
