// The engine's sticker book over HTTP (`/api/skycot/badges`), with the same credentials as the
// Family calls (the session cookie, or the desktop's bearer token). A failure is just "no
// answer": stickers never stand in a child's way, so nothing here shows an error.
import {
  isBadgeId,
  parseBookView,
  type BadgeEvent,
  type BadgeId,
  type BookView,
} from "@t3tools/skycot-rules/badges";

import { readDesktopPrimaryBearerToken } from "~/environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary/target";

export const BADGES_API_PATH = "/api/skycot/badges";

export interface BadgeAnswer {
  /** Null while someone has to be chosen on this device. */
  readonly book: BookView | null;
  readonly earned: ReadonlyArray<BadgeId>;
}

function parseAnswer(body: unknown): BadgeAnswer | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const book = record["book"] === null ? null : parseBookView(record["book"]);
  if (book === null && record["book"] !== null) return null;
  const earned = Array.isArray(record["earned"]) ? record["earned"].filter(isBadgeId) : [];
  return { book, earned };
}

async function call(method: "GET" | "POST", path: string, body?: unknown) {
  try {
    const url = resolvePrimaryEnvironmentHttpUrl(`${BADGES_API_PATH}${path}`);
    const sameOrigin =
      typeof window !== "undefined" &&
      window.desktopBridge === undefined &&
      new URL(url).origin === window.location.origin;
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (!sameOrigin) {
      const token = await readDesktopPrimaryBearerToken();
      if (token) headers["authorization"] = `Bearer ${token}`;
    }
    const response = await fetch(url, {
      method,
      headers,
      credentials: sameOrigin ? "include" : "omit",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) return null;
    return parseAnswer(await response.json().catch(() => null));
  } catch {
    return null;
  }
}

export const badgesApi = {
  book: () => call("GET", ""),
  record: (event: BadgeEvent, projectId: string | null) =>
    call("POST", "/event", { event, projectId }),
  seen: (ids: ReadonlyArray<BadgeId>) => call("POST", "/seen", { ids }),
};
