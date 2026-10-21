// The one place the product's name lives. Every title, greeting and label
// reads from here so a rename is a one-line change. nondev/brand.json does not
// exist yet; when it does, swap the literals for an import of it.
export const PRODUCT_NAME = "Foreman";

/** The assistant as a contact: "Crew · Little Fern Café website". */
export const CREW_NAME = "Crew";

export const ADVANCED_MODE_LABEL = "Advanced mode";

/** Inline SVG favicon: a hammer glyph on the system blue, no asset pipeline needed. */
export const FAVICON_DATA_URI =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#007AFF"/><g fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M38 14l12 12-5 5-12-12z"/><path d="M33 19L16 36l4 4 17-17"/><path d="M16 48l6-6"/></g></svg>',
  );

export function documentTitle(section?: string): string {
  return section ? `${section} — ${PRODUCT_NAME}` : PRODUCT_NAME;
}
