// A hash router of about forty lines instead of TanStack's file-based router.
// The server's SPA fallback and the desktop's asset handler both serve the
// stock index.html for unknown paths under /simple/, so every route must live
// in the fragment; file-based route generation in a sibling package would
// also mean a second routeTree.gen.ts and plugin config for three screens.
import { getPairingTokenFromUrl } from "@t3tools/shared/remote";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

export type Route =
  | { readonly name: "home" }
  | { readonly name: "pair" }
  | { readonly name: "thread"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId }
  | { readonly name: "not-found"; readonly path: string };

export function parseRoute(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  // Pairing links put the token in the fragment (`#token=…`), which is also
  // where our routes live; a fragment carrying a token is the pairing screen.
  if (!raw.startsWith("/")) {
    if (raw === "") return { name: "home" };
    if (getPairingTokenFromUrl(new URL(`http://x/#${raw}`)) !== null) return { name: "pair" };
    return { name: "not-found", path: raw };
  }
  const segments = raw.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return { name: "home" };
  if (segments[0] === "pair" && segments.length === 1) return { name: "pair" };
  if (segments[0] === "thread" && segments.length === 3) {
    return {
      name: "thread",
      environmentId: decodeURIComponent(segments[1]!) as EnvironmentId,
      threadId: decodeURIComponent(segments[2]!) as ThreadId,
    };
  }
  return { name: "not-found", path: raw };
}

export function threadHref(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `#/thread/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
}

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseRoute(hash);
}

export function navigate(href: string): void {
  window.location.hash = href.startsWith("#") ? href.slice(1) : href;
}
