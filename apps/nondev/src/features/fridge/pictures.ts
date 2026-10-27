// The picture of the real page the Mac app captured while the child had it open
// (`GET /api/skycot/family/fridge/picture?hash=`). Like the card, it is fetched with this
// client's sign-in (an <img> pointing at the engine could not carry the desktop's token) and
// handed to an <img> as a data address, so it can only ever be looked at, never run. The name is
// the card's hash, so a kept answer is right until the page changes and gets a new hash.
import { FAMILY_API_PATH, callEngine } from "../family/api";

export type MagnetPicture =
  | { readonly kind: "picture"; readonly src: string }
  | { readonly kind: "unavailable" };

const KEEP = 60;
const cache = new Map<string, Promise<MagnetPicture>>();

function dataAddress(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

export function readMagnetPicture(hash: string): Promise<MagnetPicture> {
  const known = cache.get(hash);
  if (known !== undefined) return known;
  const pending = callEngine("GET", `${FAMILY_API_PATH}/fridge/picture`, undefined, { hash })
    .then(async (response): Promise<MagnetPicture> => {
      const blob = response.ok ? await response.blob() : null;
      const src = blob !== null && blob.type === "image/png" ? await dataAddress(blob) : null;
      if (src === null || !src.startsWith("data:image/png")) {
        cache.delete(hash);
        return { kind: "unavailable" };
      }
      return { kind: "picture", src };
    })
    .catch((): MagnetPicture => {
      cache.delete(hash);
      return { kind: "unavailable" };
    });
  cache.set(hash, pending);
  if (cache.size > KEEP) cache.delete(cache.keys().next().value!);
  return pending;
}
