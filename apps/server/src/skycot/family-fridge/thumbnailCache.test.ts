// nondev-seam: skycot-fridge-thumbnail-cache-test
import { assert, it } from "@effect/vitest";

import {
  cachedThumbnail,
  MAX_THUMBNAIL_CACHE_BYTES,
  rememberThumbnail,
  secretLookingPath,
  type ThumbnailCacheEntry,
} from "./thumbnailCache.ts";

const entry = (
  pagePath: string,
  contentHash: string,
  html: string,
  storedAt = 1,
): ThumbnailCacheEntry => ({
  pagePath,
  contentHash,
  html,
  storedAt,
});

it("hits only the same page and content hash", () => {
  const entries = [entry("games/index.html", "a", "safe page")];
  assert.equal(cachedThumbnail(entries, "games/index.html", "a"), "safe page");
  assert.isNull(cachedThumbnail(entries, "games/index.html", "b"));
  assert.isNull(cachedThumbnail(entries, "other/index.html", "a"));
});

it("replaces stale content and prunes oldest pages within the byte bound", () => {
  const old = entry("index.html", "old", "old");
  const next = rememberThumbnail([old], entry("index.html", "new", "new", 2));
  assert.isNull(cachedThumbnail(next, "index.html", "old"));
  assert.equal(cachedThumbnail(next, "index.html", "new"), "new");
  const bounded = rememberThumbnail(
    [entry("old.html", "a", "x".repeat(MAX_THUMBNAIL_CACHE_BYTES))],
    entry("new.html", "b", "y".repeat(20)),
  );
  assert.equal(cachedThumbnail(bounded, "new.html", "b"), "y".repeat(20));
  assert.isNull(cachedThumbnail(bounded, "old.html", "a"));
});

it("refuses secret-looking page and asset paths", () => {
  assert.isTrue(secretLookingPath(".env"));
  assert.isTrue(secretLookingPath("private/keys/id_rsa"));
  assert.isFalse(secretLookingPath("assets/balloon.png"));
});
