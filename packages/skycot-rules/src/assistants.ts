// nondev-seam: skycot-rules-package
// Which AI assistants a child may use while the Family profile is on, and what a grown-up is
// told before choosing one. Shared by the engine (SkycotFamilyLockdown, which enforces it) and
// the plain client (the refusal card, the allow sheet, Settings › Family), so the words a
// parent reads and the rule the engine applies never drift apart.
//
// Codex and Claude: SKYCOT starts them without the grown-up's own add-ons (plugins,
// connectors, helper tools), so they need no extra say-so. Every other assistant: SKYCOT can't
// switch its add-ons off, so it only starts for a child once a grown-up has allowed it with
// the parent code, after reading the two points below (its age terms, and the add-ons).

/** Assistants whose own add-ons SKYCOT switches off in the Family profile. */
export const LOCKED_DOWN_ASSISTANTS: ReadonlyArray<string> = ["codex", "claudeAgent"];

export function isLockedDownAssistant(driver: string): boolean {
  return LOCKED_DOWN_ASSISTANTS.includes(driver);
}

/** A driver id the engine may keep in the profile (it is never shown to anyone). */
export const ASSISTANT_DRIVER_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/** How many assistants a profile can have allowed; far more than SKYCOT can drive. */
export const MAX_ALLOWED_ASSISTANTS = 32;

/** True for an assistant a grown-up can allow (any well-formed one SKYCOT can't lock down). */
export function canAllowAssistant(driver: string): boolean {
  return ASSISTANT_DRIVER_PATTERN.test(driver) && !isLockedDownAssistant(driver);
}

const ASSISTANT_NAMES: Readonly<Record<string, string>> = {
  codex: "Codex",
  claudeAgent: "Claude",
  cursor: "Cursor",
  opencode: "OpenCode",
  opencode2: "OpenCode",
  grok: "Grok",
  antigravity: "Antigravity",
  pi: "Pi",
  muse: "Muse",
};

/** "Cursor"; "this assistant" for one SKYCOT has no name for (ACP agents, later additions). */
export function assistantName(driver: string): string {
  return ASSISTANT_NAMES[driver] ?? "this assistant";
}

/** Like `assistantName`, for the start of a sentence or a title. */
export function assistantTitle(driver: string): string {
  const name = assistantName(driver);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export interface AssistantAgeTerms {
  /** One plain sentence, as of the date the site's FAQ gives. */
  readonly sentence: string;
  /** The provider's own terms page, where SKYCOT's legal notes already cite one. */
  readonly link: string | null;
}

/** As the home page FAQ says it (docs/skycot-site/home.html), October 2026. */
export const AGE_TERMS_AS_OF = "As of October 2026";

// Links: only pages SKYCOT's legal notes already cite (docs/legal/WEBSITE-LEGAL-NOTES.md 6.1).
const AGE_TERMS: Readonly<Record<string, AssistantAgeTerms>> = {
  codex: {
    sentence: `${AGE_TERMS_AS_OF}, OpenAI's terms allow 13 to 17 year olds with a parent's permission.`,
    link: "https://openai.com/policies/row-terms-of-use/",
  },
  claudeAgent: {
    sentence: `${AGE_TERMS_AS_OF}, Anthropic's Claude requires every user to be 18 or over.`,
    link: "https://www.anthropic.com/legal/consumer-terms",
  },
  cursor: {
    sentence: `${AGE_TERMS_AS_OF}, Cursor requires every user to be 18 or over.`,
    link: "https://cursor.com/terms-of-service",
  },
  antigravity: {
    sentence:
      "Google sets its own rules for Gemini and Antigravity. Check Google's terms for age rules.",
    link: "https://antigravity.google/terms",
  },
  grok: {
    sentence: "Check Grok's own terms for age rules.",
    link: "https://x.ai/legal/terms-of-service",
  },
};

/** What the provider's own terms say about age, or a plain pointer to them. */
export function assistantAgeTerms(driver: string): AssistantAgeTerms {
  return (
    AGE_TERMS[driver] ?? {
      sentence: `Check ${assistantName(driver)}'s own terms for age rules.`,
      link: null,
    }
  );
}

/** The second point a grown-up reads before allowing an assistant SKYCOT can't lock down. */
export function addOnsSentence(driver: string): string {
  const name = assistantName(driver);
  return `SKYCOT can't switch off ${name}'s own add-ons (plugins, connectors and helper tools set up on this computer), so a child using ${name} may reach them.`;
}

/** What still holds for an allowed assistant: SKYCOT's own Family rules. */
export const STILL_APPLIES =
  "SKYCOT's other Family rules still apply: it asks first, makes a plan first, keeps the shield on, keeps bedtime and limits, and needs the parent code for installs, the internet and publishing.";

/**
 * Words every refusal of an assistant that is not allowed contains, so the client can show
 * its own card for it. Part of the engine's sentence below; keep them together.
 */
export const NOT_ALLOWED_MARK = "isn't allowed in the Family profile yet";

/** The engine's refusal when the profile is on and this assistant is not allowed. */
export function notAllowedSentence(driver: string): string {
  const name = assistantName(driver);
  const title = assistantTitle(driver);
  return `${title} ${NOT_ALLOWED_MARK}. SKYCOT can't switch off ${name}'s own add-ons (plugins, connectors and helper tools set up on this computer), so a grown-up decides. A grown-up can allow ${name} with the parent code, here or in Settings › Family, or pick Codex or Claude for this conversation.`;
}

export function isNotAllowedRefusal(message: string | null | undefined): boolean {
  return typeof message === "string" && message.includes(NOT_ALLOWED_MARK);
}
