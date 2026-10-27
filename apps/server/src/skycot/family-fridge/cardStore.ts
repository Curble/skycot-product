// Fridge cards that survive a restart: each page's picture (the small SVG from `fridge.ts`) is
// kept as a file under `<T3 home>/userdata/skycot-fridge-cards/<hash>.svg`, so the fridge does
// not redraw every card the first time it is opened after SKYCOT starts. The hash covers the
// page's text and its fallback title, so a changed page simply gets a new file.
//
// A card is only ever text the generator produced from the page's text; nothing here opens,
// runs or renders a page. File names are hex only, and a name that is not 64 hex digits is
// never read or written. Bounded: past `MAX_CARD_FILES` the least recently used go first.
// nondev-seam: skycot-fridge-card-store

// A page's text is hashed with Node's own digest, as the rest of the fridge does.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export const CARD_DIRECTORY = "skycot-fridge-cards";
export const MAX_CARD_FILES = 2000;
/** A card is a few hundred bytes; anything bigger is not one of ours and is ignored. */
export const MAX_CARD_BYTES = 64_000;

const CARD_HASH = /^[0-9a-f]{64}$/u;

export const isCardHash = (value: string): boolean => CARD_HASH.test(value);

/** What names a card: the page's content hash and the title the card falls back to. */
export const cardHashOf = (contentHash: string, fallbackTitle: string): string =>
  NodeCrypto.createHash("sha256")
    .update(contentHash)
    .update("\n")
    .update(fallbackTitle)
    .digest("hex");

export const makeCardStore = Effect.fn("SkycotFridgeCards.make")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fileOf = (hash: string) => path.join(directory, `${hash}.svg`);

  /** The saved card, or null; reading counts as use, so a card in use is the last to go. */
  const read = Effect.fn("SkycotFridgeCards.read")(function* (hash: string) {
    if (!isCardHash(hash)) return null;
    const file = fileOf(hash);
    const info = yield* fs.stat(file).pipe(Effect.orElseSucceed(() => null));
    if (info?.type !== "File" || Number(info.size) > MAX_CARD_BYTES) return null;
    const svg = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => null));
    if (svg === null) return null;
    const at = (yield* Clock.currentTimeMillis) / 1000;
    yield* fs.utimes(file, at, at).pipe(Effect.ignore);
    return svg;
  });

  /** Drops the least recently used cards past the bound. */
  const prune = Effect.fn("SkycotFridgeCards.prune")(function* () {
    const names = (yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []))).filter(
      (name) => name.endsWith(".svg") && isCardHash(name.slice(0, -4)),
    );
    if (names.length <= MAX_CARD_FILES) return;
    const dated = yield* Effect.forEach(names, (name) =>
      fs.stat(path.join(directory, name)).pipe(
        Effect.map((info) => ({
          name,
          at: info.mtime._tag === "Some" ? info.mtime.value.getTime() : 0,
        })),
        Effect.orElseSucceed(() => ({ name, at: 0 })),
      ),
    );
    const oldest = dated.toSorted((a, b) => a.at - b.at || a.name.localeCompare(b.name));
    for (const entry of oldest.slice(0, names.length - MAX_CARD_FILES)) {
      yield* fs.remove(path.join(directory, entry.name), { force: true }).pipe(Effect.ignore);
    }
  });

  /** Saves a card (once; a card with this hash already says the same thing). */
  const write = Effect.fn("SkycotFridgeCards.write")(function* (hash: string, svg: string) {
    if (!isCardHash(hash) || svg.length > MAX_CARD_BYTES) return;
    const file = fileOf(hash);
    yield* fs.makeDirectory(directory, { recursive: true });
    const temp = `${file}.${NodeCrypto.randomBytes(6).toString("hex")}.tmp`;
    yield* fs.writeFileString(temp, svg, { mode: 0o600 });
    yield* fs.rename(temp, file);
    yield* prune();
  });

  return { read, write };
});

export type CardStore = Effect.Success<ReturnType<typeof makeCardStore>>;
