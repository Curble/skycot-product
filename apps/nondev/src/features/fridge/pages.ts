// The pages behind the fridge's thumbnails, as the engine sends them: self-contained, with the
// project's own stylesheets and pictures inside (apps/server skycot/family-fridge/thumbnail.ts).
// Kept in memory for this window so scrolling back and forth does not ask again; a page that
// changed has a new version and is asked for afresh.
import { request } from "../family/api";

export type MagnetPage =
  | { readonly kind: "page"; readonly html: string }
  | { readonly kind: "gone" }
  | { readonly kind: "unavailable" };

const KEEP = 60;
const cache = new Map<string, Promise<MagnetPage>>();

/** `{ html }`: the page, or null when it is not there any more. */
export function parseMagnetPage(body: unknown): { readonly html: string | null } | null {
  if (typeof body !== "object" || body === null || !("html" in body)) return null;
  const html = (body as Record<string, unknown>)["html"];
  return typeof html === "string" ? { html } : html === null ? { html: null } : null;
}

export function readMagnetPage(input: {
  readonly threadId: string;
  readonly page: string;
  readonly version: number;
}): Promise<MagnetPage> {
  const key = `${input.threadId}\n${input.page}\n${input.version}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  const pending = request("GET", "/fridge/page", undefined, parseMagnetPage, {
    threadId: input.threadId,
    page: input.page,
  }).then((result): MagnetPage => {
    if (result.ok) {
      return result.value.html === null
        ? { kind: "gone" }
        : { kind: "page", html: result.value.html };
    }
    // Not kept: the engine may answer next time.
    cache.delete(key);
    return { kind: "unavailable" };
  });
  cache.set(key, pending);
  if (cache.size > KEEP) cache.delete(cache.keys().next().value!);
  return pending;
}
