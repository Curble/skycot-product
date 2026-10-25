// nondev-seam: skycot-update-count-worker
export interface Env {
  readonly DOWNLOADS: R2Bucket;
  readonly SKYCOT_COUNTS?: AnalyticsEngineDataset;
  readonly DAILY_SALT_SECRET?: string;
}

const FEED_PATH = "/mac/latest-mac.yml";
const VERSION = /\bSKYCOT\/([^\s)]+)/i;

export async function anonymousId(secret: string, date: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${secret}${date}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );
  return Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function countUpdate(request: Request, env: Env): Promise<void> {
  try {
    if (!env.SKYCOT_COUNTS || !env.DAILY_SALT_SECRET) return;
    if (request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1") return;
    const ip = request.headers.get("cf-connecting-ip");
    if (!ip) return;
    const date = new Date().toISOString().slice(0, 10);
    const id = await anonymousId(
      env.DAILY_SALT_SECRET,
      date,
      `${ip}|${request.headers.get("user-agent") ?? ""}`,
    );
    const version = VERSION.exec(request.headers.get("user-agent") ?? "")?.[1] ?? "unknown";
    env.SKYCOT_COUNTS.writeDataPoint({
      indexes: [id],
      blobs: ["update-check", version],
      doubles: [1],
    });
  } catch {
    // A failed count must never delay or fail an update check.
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== FEED_PATH || !["GET", "HEAD"].includes(request.method)) {
      return new Response("Not found", { status: 404 });
    }
    try {
      const onlyIf: R2Conditional = {};
      const etag = request.headers.get("if-none-match");
      const modifiedSince = request.headers.get("if-modified-since");
      if (etag !== null) onlyIf.etagDoesNotMatch = etag;
      if (modifiedSince !== null && etag === null) {
        const timestamp = Date.parse(modifiedSince);
        if (Number.isFinite(timestamp)) onlyIf.uploadedAfter = new Date(timestamp);
      }
      const object = await env.DOWNLOADS.get("mac/latest-mac.yml", { onlyIf });
      if (!object) return new Response("Not found", { status: 404 });
      const headers = new Headers({
        "content-type": "text/yaml",
        "cache-control": "no-cache",
        etag: object.httpEtag,
        "last-modified": object.uploaded.toUTCString(),
      });
      if (!("body" in object)) {
        if (request.method === "GET") ctx.waitUntil(countUpdate(request, env));
        return new Response(null, { status: 304, headers });
      }
      if (request.method === "HEAD") {
        ctx.waitUntil(countUpdate(request, env));
        return new Response(null, { status: 200, headers });
      }
      ctx.waitUntil(countUpdate(request, env));
      return new Response(object.body, { status: 200, headers });
    } catch {
      return new Response("Feed unavailable", { status: 502 });
    }
  },
};

export { countUpdate, FEED_PATH };
