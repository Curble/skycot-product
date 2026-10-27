// Which AI assistants a child can use in the Family profile, as a grown-up reads it: Codex and
// Claude are locked down (SKYCOT switches their own add-ons off); every other one needs a
// grown-up's OK, once, with the parent code, after reading its age terms and what SKYCOT can't
// switch off. The engine keeps the list and refuses the rest (SkycotFamilyLockdown); the words
// and the rule come from one place (`@t3tools/skycot-rules/assistants`).
import {
  addOnsSentence,
  assistantAgeTerms,
  assistantName,
  assistantTitle,
  isLockedDownAssistant,
  isNotAllowedRefusal,
  LOCKED_DOWN_ASSISTANTS,
  STILL_APPLIES,
  type AssistantAgeTerms,
} from "@t3tools/skycot-rules/assistants";

export type AssistantFamilyState = "locked-down" | "allowed" | "not-allowed";

export function assistantFamilyState(
  driver: string,
  allowed: ReadonlyArray<string>,
): AssistantFamilyState {
  if (isLockedDownAssistant(driver)) return "locked-down";
  return allowed.includes(driver) ? "allowed" : "not-allowed";
}

export const ASSISTANT_STATE_LABEL: Readonly<Record<AssistantFamilyState, string>> = {
  "locked-down": "Locked down",
  allowed: "Allowed by a grown-up",
  "not-allowed": "Not allowed",
};

/** One line under an assistant's name in Settings › Family. */
export function assistantStateLine(state: AssistantFamilyState): string {
  switch (state) {
    case "locked-down":
      return "SKYCOT switches off its own add-ons for a child. Nothing to allow.";
    case "allowed":
      return "Starts for a child with its own add-ons. SKYCOT's other Family rules still apply.";
    case "not-allowed":
      return "Won't start for a child until a grown-up allows it.";
  }
}

/** Locked-down assistants first (Codex, Claude), then the rest in the order given. */
export function familyAssistantOrder(drivers: ReadonlyArray<string>): ReadonlyArray<string> {
  const unique = [...new Set(drivers)];
  return [
    ...LOCKED_DOWN_ASSISTANTS.filter((driver) => unique.includes(driver)),
    ...unique.filter((driver) => !isLockedDownAssistant(driver)),
  ];
}

export interface AllowSheetCopy {
  readonly title: string;
  readonly description: string;
  readonly ageTitle: string;
  readonly age: AssistantAgeTerms;
  readonly linkLabel: string;
  readonly addOnsTitle: string;
  readonly addOns: string;
  readonly stillApplies: string;
  readonly codeHelp: string;
  readonly confirm: string;
  readonly done: string;
}

/** The sheet a grown-up reads before allowing an assistant SKYCOT can't lock down. */
export function allowSheetCopy(driver: string): AllowSheetCopy {
  const name = assistantName(driver);
  const title = assistantTitle(driver);
  return {
    title: `Allow ${name} for the Family profile?`,
    description: `It's your choice for your children. Read these two points first.`,
    ageTitle: "Age rules",
    age: assistantAgeTerms(driver),
    linkLabel: `Read ${name}'s terms`,
    addOnsTitle: "Add-ons SKYCOT can't switch off",
    addOns: addOnsSentence(driver),
    stillApplies: STILL_APPLIES,
    codeHelp: `Allowing lasts until you stop it in Settings › Family. It's for every child here.`,
    confirm: `Allow ${name}`,
    done: `${title} is allowed for the Family profile. Send the message again to start.`,
  };
}

/** The chat card when a child's message was refused because the assistant isn't allowed. */
export interface RefusalCardCopy {
  /** What the child reads: no technical words. */
  readonly title: string;
  readonly body: string;
  /** For the grown-up, under the child's lines. */
  readonly grownUp: string;
  readonly allow: string;
  /** After a grown-up allowed it (here or in Settings). */
  readonly allowedTitle: string;
  readonly allowedBody: string;
}

export function refusalCardCopy(driver: string | null): RefusalCardCopy {
  const name = driver === null ? "this assistant" : assistantName(driver);
  const title = driver === null ? "This assistant" : assistantTitle(driver);
  return {
    title: "Ask a grown-up to say yes",
    body: `${title} can't help here until a grown-up says yes. Your message wasn't sent to it.`,
    grownUp:
      driver === null
        ? "For a grown-up: SKYCOT can't switch off this assistant's own add-ons, so you decide. Allow it in Settings › Family with the parent code, or pick Codex or Claude for this conversation."
        : `For a grown-up: SKYCOT can't switch off ${name}'s own add-ons, so you decide. Allow it here with the parent code, or pick Codex or Claude for this conversation.`,
    allow: `Allow ${name} for the Family profile…`,
    allowedTitle: `${title} is allowed now`,
    allowedBody: "Send the message again to start.",
  };
}

/** True for the engine's refusal of an assistant nobody allowed (the error item's message). */
export function isAssistantRefusal(message: string | null | undefined): boolean {
  return isNotAllowedRefusal(message);
}

/** Where a parent picks an assistant for a child: Codex's and Claude's age terms. */
export function familyAgeTermsNote(): string {
  return [
    "Codex comes from OpenAI, and Claude from Anthropic.",
    assistantAgeTerms("codex").sentence,
    assistantAgeTerms("claudeAgent").sentence.replace(/^As of October 2026, /, ""),
    "Each service sets its own rules, and the choice is yours. Any other AI needs your OK in Settings › Family.",
  ].join(" ");
}
