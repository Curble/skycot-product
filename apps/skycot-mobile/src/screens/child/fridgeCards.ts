// nondev-seam: skycot-fridge-card-draw
// Fetching and remembering the fridge cards on the phone. The pure rules live here so they
// can be tested: which text is safe to draw, and when a card is fetched again.

/**
 * The card text only if it is safe to draw: a card is a static picture, so anything that
 * mentions a script is refused outright (the phone then shows the plain icon instead).
 */
export function safeCardSvg(text: string | null): string | null {
  if (text === null) return null;
  return /<script/iu.test(text) ? null : text;
}

export interface CardCache {
  /** What is known for this hash right now, without fetching. */
  readonly peek: (hash: string) => string | null;
  /** The card for this hash: kept answer, or one fetch shared by everyone asking. */
  readonly load: (
    hash: string,
    fetchCard: (hash: string) => Promise<string | null>,
  ) => Promise<string | null>;
}

/**
 * A small memory of cards by hash. A card's name is the hash of what it shows, so a kept
 * answer is always right and a changed page (new hash) is simply fetched again. A failed
 * fetch is not kept, so the next look tries again. Only the newest `limit` cards are held.
 */
export function createCardCache(limit = 60): CardCache {
  const done = new Map<string, string>();
  const pending = new Map<string, Promise<string | null>>();
  const remember = (hash: string, svg: string) => {
    done.delete(hash);
    done.set(hash, svg);
    while (done.size > limit) done.delete(done.keys().next().value!);
  };
  return {
    peek: (hash) => done.get(hash) ?? null,
    load: (hash, fetchCard) => {
      const kept = done.get(hash);
      if (kept !== undefined) return Promise.resolve(kept);
      const running = pending.get(hash);
      if (running !== undefined) return running;
      const started = fetchCard(hash)
        .then((text) => {
          const svg = safeCardSvg(text);
          if (svg !== null) remember(hash, svg);
          return svg;
        })
        .catch(() => null)
        .finally(() => pending.delete(hash));
      pending.set(hash, started);
      return started;
    },
  };
}
