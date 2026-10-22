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
 * The mascot shares the product's name (decided 22 Oct 2026): the cloud is SKYCOT too. In copy
 * the character is simply SKYCOT ("SKYCOT says hello"); `MASCOT_FULL_NAME` is only for places
 * where it must be clear we mean the character rather than the app (spoken labels, About).
 * Never a different name. Safety moments stay plain: no mascot voice on approval cards.
 */
export const MASCOT_NAME = "SKYCOT";

/** "SKYCOT the cloud": the character, unmistakably. */
export const MASCOT_FULL_NAME = `${MASCOT_NAME} the cloud`;

export function documentTitle(section?: string): string {
  return section ? `${section} — ${PRODUCT_NAME}` : PRODUCT_NAME;
}
