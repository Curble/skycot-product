// A picture of the real page for its fridge magnet. When a child has their page open in
// Preview (the sealed frame inside this window), the Mac app takes a small snapshot of exactly
// that frame and the engine keeps it beside the page's card (`POST /fridge/picture`). It only
// ever runs for the frame the child is looking at, only in the desktop app, once per version of
// a page, and a failure is silent: the magnet simply keeps showing its card.
import { isElectron } from "../../app/platform";
import { FAMILY_API_PATH, callEngine } from "../family/api";
import { parseFridge, type FridgeItem } from "./fridge";
import { refreshFridge } from "./store";

/** How long a page gets to paint after its frame has loaded. */
export const CAPTURE_DELAY_MS = 700;
/** The same, for the Mac app's side Preview pane (a native page view that paints a little later). */
export const PANE_CAPTURE_DELAY_MS = 1200;
/** Longest side of the snapshot, in pixels: plenty for a magnet, small to keep. */
export const CAPTURE_MAX_WIDTH = 640;

/** How many times a page is looked at again when its picture came out blank. */
export const BLANK_RETRIES = 3;
/** How long a blank page gets before the next look. */
export const BLANK_RETRY_MS = 1500;
/** Set on the document while the frame's picture is taken, so SKYCOT's own buttons stay out. */
export const CAPTURING_ATTRIBUTE = "data-fm-capturing";

/**
 * Whether a picture shows nothing: all but a sliver of it is one flat colour. `pixels` is RGBA.
 * A page that has not drawn yet (a white canvas) is blank; a start screen with a title is not.
 */
export function pixelsLookBlank(pixels: ArrayLike<number>): boolean {
  const count = Math.floor(pixels.length / 4);
  if (count === 0) return true;
  // The most common colour, in coarse steps so soft gradients and shadows count as one.
  const tally = new Map<number, number>();
  for (let index = 0; index < count; index += 1) {
    const at = index * 4;
    const bucket =
      ((pixels[at]! >> 4) << 8) | ((pixels[at + 1]! >> 4) << 4) | (pixels[at + 2]! >> 4);
    tally.set(bucket, (tally.get(bucket) ?? 0) + 1);
  }
  let most = 0;
  for (const amount of tally.values()) most = Math.max(most, amount);
  return most / count > 0.985;
}

/** Looks at a captured PNG; null when this window cannot look (then the picture is kept). */
async function pictureLooksBlank(pngBase64: string): Promise<boolean | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  try {
    const bytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const side = 64;
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) return null;
    // The outer edge is the frame's own border and rounded corners, not the page.
    const inset = 0.04;
    context.drawImage(
      bitmap,
      bitmap.width * inset,
      bitmap.height * inset,
      bitmap.width * (1 - 2 * inset),
      bitmap.height * (1 - 2 * inset),
      0,
      0,
      side,
      side,
    );
    bitmap.close();
    return pixelsLookBlank(context.getImageData(0, 0, side, side).data);
  } catch {
    return null;
  }
}

const pause = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms));
const nextPaint = () =>
  new Promise<void>((done) => {
    if (typeof requestAnimationFrame !== "function") done();
    else requestAnimationFrame(() => requestAnimationFrame(() => done()));
  });

/** Versions of a page (by content hash) already taken in this window. */
const taken = new Set<string>();

/** Forgets what was taken (tests). */
export function resetCaptureMemory(): void {
  taken.clear();
}

/** The file name a path points at; a folder (or "/") means its `index.html`. */
export function pageFileName(path: string): string {
  let plain = path;
  try {
    plain = decodeURIComponent(path);
  } catch {
    // Keep the raw path.
  }
  return plain.split("/").at(-1) || "index.html";
}

function pickItem(
  items: ReadonlyArray<FridgeItem>,
  threadId: string,
  page: string,
): FridgeItem | null {
  const own = items.filter((item) => item.threadId === threadId);
  return (
    own.find((item) => item.page === page) ??
    own.find((item) => pageFileName(item.page) === pageFileName(page)) ??
    (own.length === 1 ? own[0]! : null)
  );
}

/** Where the picture comes from: the sealed frame in this window, or the Preview pane's tab. */
export type CaptureSource =
  | { readonly kind: "frame"; readonly frame: HTMLIFrameElement | null }
  | { readonly kind: "tab"; readonly tabId: string };

export async function captureMagnetPicture(input: {
  readonly source: CaptureSource;
  readonly threadId: string;
  readonly page: string;
}): Promise<boolean> {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  const { source } = input;
  if (!isElectron || bridge === undefined) return false;
  if (source.kind === "frame" && (bridge.captureRegion === undefined || source.frame === null))
    return false;
  if (source.kind === "tab" && bridge.preview?.capturePicture === undefined) return false;
  let key: string | null = null;
  try {
    const listed = await callEngine("GET", `${FAMILY_API_PATH}/fridge`);
    if (!listed.ok) return false;
    const item = pickItem(parseFridge(await listed.json()) ?? [], input.threadId, input.page);
    // No magnet for this page, or it already has its picture: nothing to do.
    if (item?.contentHash === undefined || item.hasPicture === true) return false;
    if (taken.has(item.contentHash)) return false;
    key = item.contentHash;
    taken.add(key);
    const take = async (): Promise<{ readonly pngBase64: string } | null> => {
      if (source.kind === "tab") {
        return (await bridge.preview?.capturePicture?.(source.tabId, CAPTURE_MAX_WIDTH)) ?? null;
      }
      const frame = source.frame;
      if (frame === null || !frame.isConnected) throw new Error("frame gone");
      // SKYCOT's own buttons sit on top of the frame ("Play full screen"): out of the picture.
      document.documentElement.setAttribute(CAPTURING_ATTRIBUTE, "");
      try {
        await nextPaint();
        const box = frame.getBoundingClientRect();
        const zoom = bridge.getWindowZoomFactor?.() ?? 1;
        return (
          (await bridge.captureRegion?.({
            x: box.left * zoom,
            y: box.top * zoom,
            width: box.width * zoom,
            height: box.height * zoom,
            maxWidth: CAPTURE_MAX_WIDTH,
          })) ?? null
        );
      } finally {
        document.documentElement.removeAttribute(CAPTURING_ATTRIBUTE);
      }
    };
    // A page that has drawn nothing yet makes a blank picture, and a blank picture on the
    // fridge is worse than the card: look again a few times, and keep nothing if it stays blank.
    let shot = await take();
    for (let again = 0; again < BLANK_RETRIES && shot !== null; again += 1) {
      if ((await pictureLooksBlank(shot.pngBase64)) !== true) break;
      shot = null;
      if (again === BLANK_RETRIES - 1) break;
      await pause(BLANK_RETRY_MS);
      shot = await take();
    }
    if (shot === null) throw new Error("no picture");
    const sent = await callEngine("POST", `${FAMILY_API_PATH}/fridge/picture`, {
      threadId: item.threadId,
      page: item.page,
      contentHash: item.contentHash,
      pngBase64: shot.pngBase64,
    });
    if (!sent.ok) throw new Error("not kept");
    void refreshFridge();
    return true;
  } catch (error) {
    // The next time the page is opened gets another try.
    if (key !== null) taken.delete(key);
    console.debug("fridge picture not taken", error);
    return false;
  }
}

/**
 * Whether the address the Preview pane loaded is the page that was asked for. The pane's own
 * server answers a folder's `index.html` at the folder itself ("/"), so an address with no file
 * name counts as `index.html`; otherwise the file names must match.
 */
export function loadedPageMatches(url: string, asked: string): boolean {
  let loadedPath: string;
  try {
    loadedPath = decodeURIComponent(new URL(url).pathname);
  } catch {
    return false;
  }
  return pageFileName(loadedPath) === pageFileName(asked);
}
