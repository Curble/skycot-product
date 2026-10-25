// nondev-seam: skycot-update-count-tests
import { describe, expect, it, vi } from "vite-plus/test";

import worker, { anonymousId, type Env } from "./worker.ts";

const feedBytes = new Uint8Array([0x76, 0x65, 0x72, 0x73, 0x69, 0x6f, 0x6e, 0x3a, 0x20, 0x31]);
const uploaded = new Date("2026-10-25T12:00:00.000Z");

function setup(options: { missing?: boolean; throwOnWrite?: boolean } = {}) {
  const writes: Array<{ indexes: string[]; blobs: string[]; doubles: number[] }> = [];
  const object = {
    body: options.missing ? undefined : new Blob([feedBytes]).stream(),
    httpEtag: '"feed-tag"',
    uploaded,
  };
  const env = {
    DOWNLOADS: {
      get: vi.fn(
        async (_key: string, requestOptions?: { onlyIf?: { etagDoesNotMatch?: string } }) =>
          requestOptions?.onlyIf?.etagDoesNotMatch === '"feed-tag"'
            ? { httpEtag: object.httpEtag, uploaded: object.uploaded }
            : object,
      ),
    },
    DAILY_SALT_SECRET: "test-secret",
    SKYCOT_COUNTS: {
      writeDataPoint: (point: (typeof writes)[number]) => {
        if (options.throwOnWrite) throw new Error("binding unavailable");
        writes.push(point);
      },
    },
  } as unknown as Env;
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
  } as unknown as ExecutionContext;
  return { env, ctx, pending, writes };
}

describe("SKYCOT update counter", () => {
  it("serves the exact bytes and supports HEAD and conditional 304", async () => {
    const { env, ctx } = setup();
    const get = await worker.fetch(
      new Request("https://downloads.skycot.com/mac/latest-mac.yml"),
      env,
      ctx,
    );
    expect(get.status).toBe(200);
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(feedBytes);
    expect(get.headers.get("content-type")).toBe("text/yaml");
    expect(get.headers.get("cache-control")).toBe("no-cache");

    const head = await worker.fetch(
      new Request("https://downloads.skycot.com/mac/latest-mac.yml", { method: "HEAD" }),
      env,
      ctx,
    );
    expect(head.status).toBe(200);
    expect((await head.arrayBuffer()).byteLength).toBe(0);

    const conditional = await worker.fetch(
      new Request("https://downloads.skycot.com/mac/latest-mac.yml", {
        headers: { "if-none-match": '"feed-tag"' },
      }),
      env,
      ctx,
    );
    expect(conditional.status).toBe(304);
  });

  it("does not count opted-out requests or paths outside the single feed", async () => {
    const { env, ctx, pending, writes } = setup();
    for (const header of ["dnt", "sec-gpc"]) {
      const response = await worker.fetch(
        new Request("https://downloads.skycot.com/mac/latest-mac.yml", {
          headers: { [header]: "1", "cf-connecting-ip": "192.0.2.5" },
        }),
        env,
        ctx,
      );
      expect(response.status).toBe(200);
    }
    const outside = await worker.fetch(
      new Request("https://downloads.skycot.com/mac/other.yml"),
      env,
      ctx,
    );
    expect(outside.status).toBe(404);
    await Promise.all(pending);
    expect(writes).toHaveLength(0);
  });

  it("serves the feed when Analytics Engine fails", async () => {
    const { env, ctx, pending, writes } = setup({ throwOnWrite: true });
    const response = await worker.fetch(
      new Request("https://downloads.skycot.com/mac/latest-mac.yml", {
        headers: { "cf-connecting-ip": "192.0.2.5", "user-agent": "SKYCOT/0.1.1-nondev.7.beta" },
      }),
      env,
      ctx,
    );
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(feedBytes);
    await Promise.all(pending);
    expect(writes).toHaveLength(0);
  });

  it("uses a daily HMAC id that is stable within a day and distinct across clients and days", async () => {
    const id = await anonymousId("test-secret", "2026-10-26", "192.0.2.5|SKYCOT/1");
    expect(await anonymousId("test-secret", "2026-10-26", "192.0.2.5|SKYCOT/1")).toBe(id);
    expect(await anonymousId("test-secret", "2026-10-27", "192.0.2.5|SKYCOT/1")).not.toBe(id);
    expect(await anonymousId("test-secret", "2026-10-26", "192.0.2.6|SKYCOT/1")).not.toBe(id);
    expect(id).not.toContain("192.0.2.5");
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});
