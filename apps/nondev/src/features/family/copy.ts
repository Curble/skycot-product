// Every sentence the Family profile shows, in one place. Rules as in plain/copy.ts: name the
// outcome, never "invalid", and never promise more than the engine actually enforces.
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
    "The assistant always asks before changing or running anything, and SKYCOT's engine holds it to that: no riskier mode can be switched on, from here or anywhere else.",
    "Anything that uses the internet, installs something, deletes files or reaches outside the project waits for a grown-up's parent code.",
    "Publishing, automations, opening another folder, changing the AI assistants and the developer tools all ask for the parent code.",
    "The assistant is told it is helping a child: kind, simple, age-appropriate, and never asking for personal details.",
    "Uses the Workshop look and larger text (both can be changed).",
  ],
  doesNot: [
    "Filter the web, or guarantee what the AI says: its instructions ask it to keep things child-appropriate, but AI can still get things wrong. Stay nearby.",
    "Lock the Mac, limit screen time or replace Screen Time. Other apps — Terminal, Finder, other browsers — are outside SKYCOT.",
    "Stop someone who can use this Mac's Terminal or Finder: deleting the profile file in SKYCOT's data folder turns it off.",
  ],
  honesty:
    "These are guardrails for a child who isn't trying to get round them, kept by SKYCOT's engine on this Mac — not a security product.",
  storage: `${PRODUCT_NAME}'s engine keeps a scrambled version of the code on this Mac. Nobody can read it back, including ${PRODUCT_NAME}. If it's forgotten, see "Forgotten the code?" in the guide.`,
  askGrownUp: "Ask a grown-up",
  needsGrownUp: "Needs a grown-up",
  legacyTitle: "Move the Family profile to SKYCOT's engine",
  legacyBody:
    "This profile was set up in this browser only, so it could be cleared from the browser. Enter the parent code once and SKYCOT's engine will keep it and enforce it everywhere.",
} as const;

/** What the code sheet says it is for. */
export function actionReason(action: FamilyAction): string {
  switch (action) {
    case "publish":
      return "Publishing puts work where other people can see it, so a parent confirms first.";
    case "advancedMode":
      return `${ADVANCED_MODE_LABEL} is the full developer interface. The code opens it on this device for 15 minutes.`;
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
    case "openFolder":
      return "Opening another folder lets the assistant work there, so a parent chooses it.";
    case "approve":
      return "This step uses the internet, installs something, deletes or reaches outside the project, so a grown-up allows it.";
    case "aiSettings":
      return "The AI assistants use a parent's accounts and settings, so a parent changes them.";
    case "changeTheme":
      return "";
  }
}
