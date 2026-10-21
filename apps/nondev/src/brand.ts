// The one place the product's name lives in the client. Every title, greeting
// and label reads from here so a rename is a one-line change. Mirrors
// `productName` in nondev/brand.json (the desktop/build side of the brand).
export const PRODUCT_NAME = "SKYCOT";

/** The assistant as a contact: "Crew · Little Fern Café website". */
export const CREW_NAME = "Crew";

export const ADVANCED_MODE_LABEL = "Advanced mode";

/** Inline SVG favicon: the letter S on the system blue, no asset pipeline needed. */
export const FAVICON_DATA_URI =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#007AFF"/><text x="32" y="45" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="38" font-weight="700" fill="#fff">S</text></svg>',
  );

export function documentTitle(section?: string): string {
  return section ? `${section} — ${PRODUCT_NAME}` : PRODUCT_NAME;
}
