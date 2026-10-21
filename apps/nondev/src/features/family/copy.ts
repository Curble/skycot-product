// Every sentence the Family profile shows, in one place. Rules as in
// plain/copy.ts: name the outcome, never "invalid", and never promise more
// than this browser-side guardrail can keep.
import { ADVANCED_MODE_LABEL, PRODUCT_NAME } from "../../brand";
import type { FamilyAction } from "./family";

export const FAMILY_LABEL = "Family profile";

export const familyCopy = {
  title: FAMILY_LABEL,
  summary: "A safer setup for a child",
  /** The one-line status under "Family profile is on". */
  alwaysAsks: "Family profile · the assistant always asks first",
  managedElsewhere: `Managed by the ${FAMILY_LABEL} — change it in Settings › Family.`,
  does: [
    "Uses the Workshop look (Sam builds, Mo checks) unless you've already picked another.",
    "The assistant always asks before changing or running anything.",
    `Hides the riskier modes and the developer tools (${ADVANCED_MODE_LABEL}).`,
    "Asks for the parent code before publishing, creating an automation, or turning this off.",
  ],
  doesNot: [
    "Filter the web or decide what the AI may talk about.",
    "Lock the Mac, limit screen time or replace Screen Time.",
    "Stop a determined teenager: the code lives in this browser and can be cleared from the developer tools.",
  ],
  honesty:
    "These are guardrails for a child who isn't trying to get round them, not a security product.",
  storage: `${PRODUCT_NAME} keeps a scrambled version of the code in this browser only. Nobody can read it back, including ${PRODUCT_NAME}, so if it's forgotten the way back is Advanced mode or clearing this browser's site data.`,
} as const;

/** What the code sheet says it is for. */
export function actionReason(action: FamilyAction): string {
  switch (action) {
    case "publish":
      return "Publishing puts work where other people can see it, so a parent confirms first.";
    case "advancedMode":
      return `${ADVANCED_MODE_LABEL} is the full developer interface with no guardrails.`;
    case "disableFamily":
      return `Turning the ${FAMILY_LABEL} off removes every guardrail it added.`;
    case "changeCode":
      return "Enter the current parent code before choosing a new one.";
    case "createAutomation":
      return "Automations run on their own, later, so a parent sets them up.";
    case "changeAutonomy":
      return "How much the assistant does on its own is set by a parent.";
    case "rerunOnboarding":
      return "The welcome steps can change the look, the assistant and this profile.";
    case "changeTheme":
      return "";
  }
}
