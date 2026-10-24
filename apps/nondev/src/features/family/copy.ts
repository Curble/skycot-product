// Every sentence the Family profile shows, in one place. Rules as in plain/copy.ts: name the
// outcome, never "invalid", and never promise more than the engine actually enforces.
import { ADVANCED_MODE_LABEL, PRODUCT_NAME } from "../../brand";
import type { FamilyAction } from "./family";

export const FAMILY_LABEL = "Family profile";

export const familyCopy = {
  title: FAMILY_LABEL,
  summary: "A safer setup for a child",
  /** The one-line status beside the Family profile's lock, and its Settings row. */
  safeSteps: "Safe steps run by themselves; anything risky waits for a grown-up",
  managedElsewhere: `Managed by the ${FAMILY_LABEL} — change it in Settings › Family.`,
  does: [
    "Safe steps inside the project — looking at files, changing them, running a quick check — run by themselves, so a child isn't asked about every step. SKYCOT's engine checks each one first, and no riskier mode can be switched on, from here or anywhere else.",
    "Anything that uses the internet, installs something, deletes files or reaches outside the project waits for a grown-up: the parent code on the Mac, or a linked grown-up's phone or Watch.",
    "The assistant shows its plan first, and nothing changes until the child presses Build it. A parent can also have a child asked before each step, in that child's settings.",
    "Publishing, automations, opening another folder, changing the AI assistants and the developer tools all ask for the parent code.",
    "The assistant is told it is helping a child: kind, simple, age-appropriate, and never asking for personal details.",
    "Codex and Claude start without this Mac's own AI add-ons. Any other assistant waits until a grown-up allows it with the parent code, after reading its age rules.",
    "Uses the Workshop look and larger text (both can be changed).",
  ],
  doesNot: [
    "Filter the web, or guarantee what the AI says: its instructions ask it to keep things child-appropriate, but AI can still get things wrong. Stay nearby.",
    "Lock the Mac, limit screen time or replace Screen Time. Other apps — Terminal, Finder, other browsers — are outside SKYCOT.",
    "Stop someone who can use this Mac's Terminal or Finder: deleting the profile file in SKYCOT's data folder turns it off.",
  ],
  honesty:
    "These are guardrails for a child who isn't trying to get round them, kept by SKYCOT's engine on this Mac — not a security product.",
  storage: `${PRODUCT_NAME}'s engine keeps a scrambled version of the code on this Mac. Nobody can read it back, including ${PRODUCT_NAME}. If you forget it, use the reset steps below.`,
  /** While the engine answers a safe step itself, in place of its card. */
  checkingStep: "Checking this step…",
  askGrownUp: "Ask a grown-up",
  needsGrownUp: "Needs a grown-up",
  /** Beside the mascot's "ask a grown-up" pose, above a card only a parent may allow. */
  fetchGrownUp: "Time to find a grown-up",
  legacyTitle: "Move the Family profile to SKYCOT's engine",
  legacyBody:
    "This profile was set up in this browser only, so it could be cleared from the browser. Enter the parent code once and SKYCOT's engine will keep it and enforce it everywhere.",
} as const;

export const grownUpPlainNames = {
  advanced: "Open the full workshop",
  trustedAddOns: "Let SKYCOT fetch well-known add-ons (like 3D and drawing tools)",
  publishLive: "Put it online",
  publishReview: "Ask someone to check",
  recapShield: "The private-details check spotted",
} as const;

export const codeChangeWarning =
  "Changing the code signs out Mum's and Dad's phones and Watch. You'll link them again.";
export const codeChangedNotice =
  "The parent code has changed. Mum's and Dad's phones and Watch are signed out. Go to Phones and iPads to link them again.";

/**
 * How a child's steps run, in the words the composer, the conversation strip and Settings use.
 * The engine decides (SkycotPolicyReactor); these only say what it does.
 */
export function familySteps(askEachStep: boolean): {
  /** The locked pill and the conversation strip. */
  readonly label: string;
  /** One sentence after it. */
  readonly description: string;
} {
  return askEachStep
    ? {
        label: "Ask me first",
        description:
          "The assistant asks before each step, as a parent chose. Anything risky waits for a grown-up.",
      }
    : {
        label: "Safe steps",
        description: `${familyCopy.safeSteps}.`,
      };
}

/**
 * What the code sheet says it is for. A grown-up card passes its own reason ("It uses the
 * internet and installs something."), so the sheet says what this step does (QA FK-13).
 */
export function actionReason(action: FamilyAction, cardReason?: string | null): string {
  if (action === "approve" && cardReason) {
    return `${cardReason} A grown-up allows this one step with the parent code.`;
  }
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
    case "renameChild":
      return `The child's name is part of the ${FAMILY_LABEL} a parent set up.`;
    case "saveSecret":
      return "The assistant is asking for a key or password. A parent decides whether to hand one over.";
    case "voiceSettings":
      return "Voice typing sends the sound of the child's voice to the browser's speech service, so a parent decides whether it's on.";
    case "manageChildren":
      return "Names, pictures, bedtimes and limits are a parent's to set.";
    case "switchChild":
      return "SKYCOT is asleep for this child, so a grown-up switches to someone else.";
    case "seeRecap":
      return "The recap shows what a child made, asked for and needed help with, so it's for grown-ups. The code opens it on this device for 10 minutes.";
    case "deleteConversation":
      return "Deleting a conversation can't be undone, so a grown-up says yes with the parent code. It opens nothing else.";
    case "restartToUpdate":
      return `Restarting puts a new version of ${PRODUCT_NAME} in place, so a grown-up says when.`;
    case "seeAllFiles":
      return "Hidden files can hold passwords and keys, and Finder shows the rest of this Mac, so a grown-up opens them. The code shows everything on this device for 10 minutes.";
    case "changeTheme":
      return "";
  }
}
