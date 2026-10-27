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
/** Longest side of the snapshot, in pixels: plenty for a magnet, small to keep. */
export const CAPTURE_MAX_WIDTH = 640;

/** Versions of a page (by content hash) already taken in this window. */
const taken = new Set<string>();

/** Forgets what was taken (tests). */
export function resetCaptureMemory(): void {
  taken.clear();
}

function pickItem(
  items: ReadonlyArray<FridgeItem>,
  threadId: string,
  page: string,
): FridgeItem | null {
  const own = items.filter((item) => item.threadId === threadId);
  const base = (path: string) => path.split("/").at(-1);
  return (
    own.find((item) => item.page === page) ??
    own.find((item) => base(item.page) === base(page)) ??
    null
  );
}

export async function captureMagnetPicture(input: {
  readonly frame: HTMLIFrameElement | null;
  readonly threadId: string;
  readonly page: string;
}): Promise<boolean> {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  if (!isElectron || bridge?.captureRegion === undefined || input.frame === null) return false;
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
    if (!input.frame.isConnected) throw new Error("frame gone");
    const box = input.frame.getBoundingClientRect();
    const zoom = bridge.getWindowZoomFactor?.() ?? 1;
    const shot = await bridge.captureRegion({
      x: box.left * zoom,
      y: box.top * zoom,
      width: box.width * zoom,
      height: box.height * zoom,
      maxWidth: CAPTURE_MAX_WIDTH,
    });
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
