// Fridge cards that survive a restart: each page's picture (the small SVG from `fridge.ts`) is
// kept as a file under `<T3 home>/userdata/skycot-fridge-cards/<hash>.svg`, so the fridge does
// not redraw every card the first time it is opened after SKYCOT starts. The hash covers the
// page's text and its fallback title, so a changed page simply gets a new file.
//
// A card is only ever text the generator produced from the page's text; nothing here opens,
// runs or renders a page. File names are hex only, and a name that is not 64 hex digits is
// never read or written. A picture of the real page sits beside the card as `<hash>.png`. Bounded: past `MAX_CARD_FILES` the least recently used go first.
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
/** A captured picture of the real page (PNG); the Mac app keeps it small before sending it. */
export const MAX_PICTURE_BYTES = 400_000;
/** Pictures are bigger than cards, so fewer are kept (least recently used go first). */
export const MAX_PICTURE_FILES = 500;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** True when the bytes start with the PNG signature. */
export const looksLikePng = (bytes: Uint8Array): boolean =>
  bytes.length > PNG_MAGIC.length && PNG_MAGIC.every((byte, index) => bytes[index] === byte);

const CARD_HASH = /^[0-9a-f]{64}$/u;

export const isCardHash = (value: string): boolean => CARD_HASH.test(value);

/**
 * Bumped whenever the card drawing changes, so cards saved by an older SKYCOT are drawn again
 * (2: the heading line read "&apos;" as words).
 */
const CARD_DRAWING = "2";

/** What names a card: the drawing version, the page's content hash and its fallback title. */
export const cardHashOf = (contentHash: string, fallbackTitle: string): string =>
  NodeCrypto.createHash("sha256")
    .update(`card-${CARD_DRAWING}\n`)
    .update(contentHash)
    .update("\n")
    .update(fallbackTitle)
    .digest("hex");

export const makeCardStore = Effect.fn("SkycotFridgeCards.make")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fileOf = (hash: string, extension: "svg" | "png" = "svg") =>
    path.join(directory, `${hash}.${extension}`);

  /** The saved file, or null; reading counts as use, so a card in use is the last to go. */
  const readBytes = Effect.fn("SkycotFridgeCards.readBytes")(function* (
    hash: string,
    extension: "svg" | "png",
  ) {
    if (!isCardHash(hash)) return null;
    const file = fileOf(hash, extension);
    const info = yield* fs.stat(file).pipe(Effect.orElseSucceed(() => null));
    const limit = extension === "png" ? MAX_PICTURE_BYTES : MAX_CARD_BYTES;
    if (info?.type !== "File" || Number(info.size) > limit) return null;
    const bytes = yield* fs.readFile(file).pipe(Effect.orElseSucceed(() => null));
    if (bytes === null) return null;
    const at = (yield* Clock.currentTimeMillis) / 1000;
    yield* fs.utimes(file, at, at).pipe(Effect.ignore);
    return bytes;
  });

  /** The saved card, or null. */
  const read = Effect.fn("SkycotFridgeCards.read")(function* (hash: string) {
    const bytes = yield* readBytes(hash, "svg");
    return bytes === null ? null : new TextDecoder().decode(bytes);
  });

  /** The saved picture of the real page (PNG bytes), or null. */
  const readPicture = Effect.fn("SkycotFridgeCards.readPicture")(function* (hash: string) {
    const bytes = yield* readBytes(hash, "png");
    return bytes !== null && looksLikePng(bytes) ? bytes : null;
  });

  /** Whether a picture is saved (does not count as use). */
  const hasPicture = Effect.fn("SkycotFridgeCards.hasPicture")(function* (hash: string) {
    if (!isCardHash(hash)) return false;
    const info = yield* fs.stat(fileOf(hash, "png")).pipe(Effect.orElseSucceed(() => null));
    return info?.type === "File" && Number(info.size) <= MAX_PICTURE_BYTES;
  });

  /** Drops the least recently used files of one kind past its bound. */
  const prune = Effect.fn("SkycotFridgeCards.prune")(function* (
    extension: "svg" | "png",
    bound: number,
  ) {
    const suffix = `.${extension}`;
    const names = (yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []))).filter(
      (name) => name.endsWith(suffix) && isCardHash(name.slice(0, -suffix.length)),
    );
    if (names.length <= bound) return;
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
    for (const entry of oldest.slice(0, names.length - bound)) {
      yield* fs.remove(path.join(directory, entry.name), { force: true }).pipe(Effect.ignore);
    }
  });

  const save = Effect.fn("SkycotFridgeCards.save")(function* (
    hash: string,
    extension: "svg" | "png",
    data: string | Uint8Array,
  ) {
    const file = fileOf(hash, extension);
    yield* fs.makeDirectory(directory, { recursive: true });
    const temp = `${file}.${NodeCrypto.randomBytes(6).toString("hex")}.tmp`;
    if (typeof data === "string") yield* fs.writeFileString(temp, data, { mode: 0o600 });
    else yield* fs.writeFile(temp, data, { mode: 0o600 });
    yield* fs.rename(temp, file);
    yield* prune(extension, extension === "png" ? MAX_PICTURE_FILES : MAX_CARD_FILES);
  });

  /** Saves a card (once; a card with this hash already says the same thing). */
  const write = Effect.fn("SkycotFridgeCards.write")(function* (hash: string, svg: string) {
    if (!isCardHash(hash) || svg.length > MAX_CARD_BYTES) return;
    yield* save(hash, "svg", svg);
  });

  /** Saves a picture of the real page; anything that is not a small PNG is ignored. */
  const writePicture = Effect.fn("SkycotFridgeCards.writePicture")(function* (
    hash: string,
    png: Uint8Array,
  ) {
    if (!isCardHash(hash) || png.length > MAX_PICTURE_BYTES || !looksLikePng(png)) return false;
    yield* save(hash, "png", png);
    return true;
  });

  return { read, write, readPicture, writePicture, hasPicture };
});

export type CardStore = Effect.Success<ReturnType<typeof makeCardStore>>;
