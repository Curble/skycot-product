// Every sentence the Family profile shows, in one place. Rules as in plain/copy.ts: name the
// outcome, never "invalid", and never promise more than the engine actually enforces.
import { ADVANCED_MODE_LABEL, PRODUCT_NAME } from "../../brand";
import type { FamilyAction } from "./family";

export const FAMILY_LABEL = "Family profile";

/**
 * Shown in the "Link a phone or iPad" sheet when a child is picked. Version 1 of the phone app is
 * a grown-up companion (29 Oct 2026); the link still works, so a child's device only shows a note.
 */
export const childDeviceLinkNote =
  "This version of SKYCOT on iPhone and iPad is for grown-ups. A device linked as a child's shows a short note, and the child keeps making things on this Mac.";

export const familyCopy = {
  title: FAMILY_LABEL,
  summary: "A safer setup for a child",
  /** The one-line status beside the Family profile's lock, and its Settings row. */
  safeSteps: "Safe steps run by themselves; anything risky waits for a grown-up",
  managedElsewhere: `Managed by the ${FAMILY_LABEL} — change it in Settings › Family.`,
  does: [
    "Safe steps inside the project — looking at files, changing them, running a quick check — run by themselves, so a child isn't asked about every step. SKYCOT checks each one first on this Mac, and no riskier way of working can be switched on, from here or anywhere else.",
    "Web searches run without a stop. When a grown-up turns it on, familiar add-ons download without another stop. A project permission also lets its listed safe steps run for 30 days. Other internet downloads, deleting files and reaching outside the project wait for a grown-up: the parent code on the Mac, or a linked grown-up's phone or Watch.",
    "A page the child makes runs offline. If it wants pictures or data from a website, a grown-up says yes once for that page with the parent code, and can take it back in Settings › Family.",
    "Sam shows the plan first, and nothing changes until the child presses Build it. A parent can also have a child asked before each step, in that child's settings.",
    "Publishing, automations, opening another folder, changing the AI helpers and Advanced mode all ask for the parent code.",
    "Sam is told to keep everything kind and simple, to explain things at the youngest child's reading level, and never to ask for personal details. It is never told anyone's name or age.",
    "Codex and Claude start without this Mac's own AI add-ons. Any other AI waits until a grown-up allows it with the parent code, after reading its age rules.",
    "Uses the Workshop look and larger text (both can be changed).",
  ],
  doesNot: [
    "Filter the web, or guarantee what the AI says: its instructions ask it to keep things child-appropriate, but AI can still get things wrong. Stay nearby.",
    "Lock the Mac, limit screen time or replace Screen Time. Other apps — Terminal, Finder, other browsers — are outside SKYCOT.",
    "Stop someone who can use this Mac's Terminal or Finder: deleting the profile file in SKYCOT's data folder turns it off.",
  ],
  /** The one visible sentence in first-run set-up; the full lists sit behind "What does SKYCOT do?". */
  short:
    "A parent code keeps settings, publishing and Advanced mode for grown-ups, and everything stays on this Mac.",
  honesty:
    "These are guardrails for a child who isn't trying to get round them, kept by SKYCOT on this Mac — not a security product.",
  /** The approved one-line privacy promise (Settings › Privacy says the same). */
  privacyLine: `${PRODUCT_NAME} never sends your files, messages or projects. It only sends anonymous daily totals.`,
  storage: `${PRODUCT_NAME} keeps a scrambled version of the code on this Mac. Nobody can read it back, including ${PRODUCT_NAME}. If you forget it, use the reset steps below.`,
  /** While the engine answers a safe step itself, in place of its card. */
  checkingStep: "Checking this step…",
  askGrownUp: "Ask a grown-up",
  needsGrownUp: "Needs a grown-up",
  /** Beside the mascot's "ask a grown-up" pose, above a card only a parent may allow. */
  fetchGrownUp: "Time to find a grown-up",
  legacyTitle: "Move the Family profile into SKYCOT on this Mac",
  legacyBody:
    "This profile was set up in this browser only, so it could be cleared from the browser. Enter the parent code once and SKYCOT on this Mac will keep it and apply it everywhere.",
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
          "Sam asks before each step, as a parent chose. Anything risky waits for a grown-up.",
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
export function actionReason(
  action: FamilyAction,
  cardReason?: string | null,
  // The code sheet opens before the code is proven, so on a child's device it can be seen by
  // the child: there it only says that a grown-up can answer, never the grown-up's choices.
  childVisible = false,
): string {
  if (action === "aiSettings" && cardReason) return cardReason;
  const scope = childVisible ? childApprovalScopeCopy : approvalScopeCopy;
  if (action === "approve" && cardReason) {
    return `${cardReason} ${scope}`;
  }
  switch (action) {
    case "publish":
      return "Publishing puts work where other people can see it, so a parent confirms first.";
    case "advancedMode":
      return `${ADVANCED_MODE_LABEL} is the full set of tools for people who code. The code opens it on this device for 15 minutes.`;
    case "disableFamily":
      return `Turning the ${FAMILY_LABEL} off removes every guardrail it added.`;
    case "changeCode":
      return "Enter the current parent code before choosing a new one.";
    case "createAutomation":
      return "Automations run on their own, later, so a parent sets them up.";
    case "changeAutonomy":
      return "How much Sam does on its own is set by a parent.";
    case "rerunOnboarding":
      return "The welcome steps can change the look, the AI and this profile.";
    case "openFolder":
      return "Opening another folder lets Sam work there, so a parent chooses it.";
    case "approve":
      return `This step uses the internet, installs something, deletes or reaches outside the project. ${scope}`;
    case "aiSettings":
      return "The AI helpers use a parent's accounts and settings, so a parent changes them.";
    case "renameChild":
      return `The child's name is part of the ${FAMILY_LABEL} a parent set up.`;
    case "saveSecret":
      return "Sam is asking for a key or password. A parent decides whether to hand one over.";
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

export const childApprovalScopeCopy = "A grown-up can say yes here.";

export const approvalScopeCopy =
  "A grown-up can allow just this step, or choose “Allow for this project” to allow this kind of request across the project.";
