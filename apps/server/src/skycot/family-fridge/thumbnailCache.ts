// nondev-seam: skycot-fridge-thumbnail-cache
export const MAX_THUMBNAIL_CACHE_BYTES = 4_000_000;
export const MAX_THUMBNAIL_CACHE_PAGES = 100;

const svgCache = new Map<string, string>();

const svgKey = (pagePath: string, contentHash: string) => `${pagePath}\n${contentHash}`;

/** The picture already drawn in this run, if any (the fast path before the card files). */
// nondev-seam: skycot-fridge-card-store
export const peekSvgThumbnail = (pagePath: string, contentHash: string): string | null =>
  svgCache.get(svgKey(pagePath, contentHash)) ?? null;

// nondev-seam: skycot-fridge-card-store
export function storeSvgThumbnail(pagePath: string, contentHash: string, svg: string): void {
  svgCache.set(svgKey(pagePath, contentHash), svg);
  if (svgCache.size > MAX_THUMBNAIL_CACHE_PAGES) {
    svgCache.delete(svgCache.keys().next().value!);
  }
}

// nondev-seam: skycot-q51-fridge-svg-cache
export function cachedSvgThumbnail(
  pagePath: string,
  contentHash: string,
  create: () => string,
): string {
  const cached = peekSvgThumbnail(pagePath, contentHash);
  if (cached !== null) return cached;
  const svg = create();
  storeSvgThumbnail(pagePath, contentHash, svg);
  return svg;
}

export interface ThumbnailCacheEntry {
  readonly pagePath: string;
  readonly contentHash: string;
  readonly html: string;
  readonly storedAt: number;
}

export const secretLookingPath = (path: string): boolean =>
  path
    .split(/[\\/]/u)
    .some(
      (part) =>
        part.startsWith(".") ||
        /secret|password|credential|\.env|id_rsa|id_ed25519|id_ecdsa|private[_-]?key|\.(?:pem|key)$/iu.test(
          part,
        ),
    );

export const cachedThumbnail = (
  entries: ReadonlyArray<ThumbnailCacheEntry>,
  pagePath: string,
  contentHash: string,
): string | null =>
  entries.find((entry) => entry.pagePath === pagePath && entry.contentHash === contentHash)?.html ??
  null;

export const rememberThumbnail = (
  entries: ReadonlyArray<ThumbnailCacheEntry>,
  next: ThumbnailCacheEntry,
): ReadonlyArray<ThumbnailCacheEntry> => {
  const ordered = [...entries.filter((entry) => entry.pagePath !== next.pagePath), next].slice(
    -MAX_THUMBNAIL_CACHE_PAGES,
  );
  let bytes = 0;
  const kept: Array<ThumbnailCacheEntry> = [];
  for (const entry of [...ordered].reverse()) {
    const size =
      new TextEncoder().encode(entry.html).byteLength * 6 +
      entry.pagePath.length +
      entry.contentHash.length +
      128;
    if (size > MAX_THUMBNAIL_CACHE_BYTES || bytes + size > MAX_THUMBNAIL_CACHE_BYTES) continue;
    kept.push(entry);
    bytes += size;
  }
  return kept.reverse();
};
