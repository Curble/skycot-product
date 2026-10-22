// The one place the product's name lives in the client. Every title, greeting
// and label reads from here so a rename is a one-line change. Mirrors
// `productName` in nondev/brand.json (the desktop/build side of the brand).
export const PRODUCT_NAME = "SKYCOT";

/** The command people type in Terminal; mirrors `cliName` in nondev/brand.json. */
export const CLI_NAME = "skycot";

/** The registered company behind SKYCOT; SKYCOT is its registered business name. */
export const COMPANY_NAME = "Curble Pty Ltd";

export const COPYRIGHT_LINE = `© 2026 ${COMPANY_NAME}, trading as ${PRODUCT_NAME}`;

/** The assistant as a contact: "Crew · Little Fern Café website". */
export const CREW_NAME = "Crew";

export const ADVANCED_MODE_LABEL = "Advanced mode";

/**
 * The mascot's name, once the brand team picks one. Until then nothing visible names the
 * character: copy says "your SKYCOT helper" or keeps the Crew wording, and `Mascot` labels are
 * plain descriptions.
 */
export const MASCOT_NAME: string | null = null;

/** Where copy needs to refer to the mascot before it has a name. */
export const MASCOT_REFERENCE = MASCOT_NAME ?? `your ${PRODUCT_NAME} helper`;

export function documentTitle(section?: string): string {
  return section ? `${section} — ${PRODUCT_NAME}` : PRODUCT_NAME;
}
