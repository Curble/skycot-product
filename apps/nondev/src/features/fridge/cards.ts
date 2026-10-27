// The picture card the engine drew for a fridge page (`GET /api/skycot/family/fridge/card?hash=`).
// It is a static SVG, read here as plain text and shown through an <img> (data address), so
// nothing in it can run, and the request carries this client's sign-in like every other fridge
// call (an <img> pointing at the engine could not carry the desktop's token). A card's name is
// the hash of what it shows, so a kept answer is always right: a changed page has a new hash.
import { FAMILY_API_PATH, callEngine } from "../family/api";
import { parseMagnetCard } from "./cardText";

export type MagnetCard =
  | { readonly kind: "card"; readonly svg: string }
  | { readonly kind: "unavailable" };

const KEEP = 80;
const cache = new Map<string, Promise<MagnetCard>>();

export function readMagnetCard(hash: string): Promise<MagnetCard> {
  const known = cache.get(hash);
  if (known !== undefined) return known;
  const pending = callEngine("GET", `${FAMILY_API_PATH}/fridge/card`, undefined, { hash })
    .then(async (response): Promise<MagnetCard> => {
      const svg = response.ok ? parseMagnetCard(await response.text()) : null;
      if (svg === null) {
        cache.delete(hash);
        return { kind: "unavailable" };
      }
      return { kind: "card", svg };
    })
    .catch((): MagnetCard => {
      cache.delete(hash);
      return { kind: "unavailable" };
    });
  cache.set(hash, pending);
  if (cache.size > KEEP) cache.delete(cache.keys().next().value!);
  return pending;
}
