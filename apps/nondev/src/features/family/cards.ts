// How an approval card changes while the Family profile is on. The same rules the engine
// enforces (`@t3tools/skycot-rules/family`) decide which cards need a grown-up, so the card
// can say "Ask a grown-up" before anyone clicks; the engine still refuses the Allow without
// the parent code if the two ever disagree, and the card then asks for it.
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { describeFamilyMatches, evaluateFamilyRequest } from "@t3tools/skycot-rules/family";
import { filesFromPrompt } from "@t3tools/skycot-rules/files";
import { describeMatches, readCommandAsk, type RuleRequest } from "@t3tools/skycot-rules/rules";

import type { ApprovalCard, ApprovalOption } from "../../plain/approvals";
import { familyCopy } from "./copy";

type ApprovalItem = Extract<OrchestrationV2TurnItem, { type: "approval_request" }>;

/** The engine's refusal sentence (SkycotFamilyGate.FAMILY_REFUSAL_MESSAGE) contains this. */
export const FAMILY_REFUSAL_MARK = "parent code";

export function isFamilyRefusal(message: string | null): boolean {
  return message !== null && message.toLowerCase().includes(FAMILY_REFUSAL_MARK);
}

/**
 * How long a step the child needn't be asked about shows a quiet "Checking this step…" instead
 * of a card while SKYCOT's engine answers it (SkycotPolicyReactor runs safe steps by
 * themselves). Still waiting after this means the engine left it to the child (a change while
 * the plan is being made, an engine without the policy), so the ordinary card shows.
 */
export const ENGINE_CHECK_GRACE_MS = 4_000;

/** Whether a pending card is one the engine is expected to answer itself (see above). */
export function waitsForEngineCheck(input: {
  readonly familyOn: boolean;
  readonly isApproval: boolean;
  readonly decided: boolean;
  /** The card already says only a grown-up may allow it. */
  readonly needsGrownUp: boolean;
  /** The parent chose "Ask before each step" for this child. */
  readonly askEachStep: boolean;
  /** A grown-up's own phone only reads; it never waits for the Mac's engine. */
  readonly grownUpDevice: boolean;
}): boolean {
  return (
    input.familyOn &&
    input.isApproval &&
    !input.decided &&
    !input.needsGrownUp &&
    !input.askEachStep &&
    !input.grownUpDevice
  );
}

/** The tool call that shares the approval's native item, for its type (`web_search`, …). */
export function toolItemTypeFor(
  item: Pick<ApprovalItem, "nativeItemRef">,
  turnItems: ReadonlyArray<OrchestrationV2TurnItem>,
): string | undefined {
  const ref = item.nativeItemRef;
  if (ref === null || ref.nativeId === null) return undefined;
  return turnItems.find(
    (candidate) =>
      candidate.type !== "approval_request" &&
      candidate.nativeItemRef?.nativeId === ref.nativeId &&
      candidate.nativeItemRef.driver === ref.driver,
  )?.type;
}

function factsFor(item: ApprovalItem, toolCallInput: string | undefined): RuleRequest {
  switch (item.requestKind) {
    case "command": {
      const ask = readCommandAsk({
        driver: item.nativeItemRef?.driver,
        prompt: item.prompt,
        toolCallInput,
      });
      return { kind: "command", command: ask.command, leavesSandbox: ask.leavesSandbox };
    }
    case "file-change":
    case "file-read":
      return { kind: item.requestKind, files: filesFromPrompt(item.prompt) };
    case "permission":
    case "mcp-elicitation":
      return { kind: item.requestKind };
  }
}

/** Why only a grown-up may allow this ("uses the internet"), or null when the child may. */
export function familyHoldFor(
  item: ApprovalItem,
  ctx: {
    readonly projectRoot?: string | null;
    readonly projectFolder?: string | null;
    readonly toolCallInput?: string | undefined;
    readonly toolItemType?: string | undefined;
    /** The parent's "Trusted add-ons download by themselves" (the family view's). */
    readonly trustedAddOns?: boolean | undefined;
  },
): string | null {
  // The engine also knows this conversation's earlier yeses and restore points; the card does
  // not, so it may ask for a grown-up where the engine would not: never the other way round.
  const evaluation = evaluateFamilyRequest(
    { ...factsFor(item, ctx.toolCallInput), toolItemType: ctx.toolItemType },
    {
      projectRoot: ctx.projectRoot ?? null,
      projectFolder: ctx.projectFolder ?? null,
      skycotFetchesAddOns: item.nativeItemRef?.driver === "codex",
      trustedAddOns: ctx.trustedAddOns === true,
    },
  );
  if (!evaluation.needsGrownUp) return null;
  const parts = [describeFamilyMatches(evaluation.family), describeMatches(evaluation.base.matches)]
    .filter((part) => part.length > 0)
    .join(", and ");
  return parts.length > 0 ? `It ${parts}.` : "SKYCOT can't tell exactly what this does.";
}

const WIDENING = new Set(["acceptForSession", "acceptAlways"]);

/** "Allow once": the one decision a grown-up may need to make. */
export function approves(option: ApprovalOption): boolean {
  return (
    option.decision.type === "runtime-request.respond" &&
    "decision" in option.decision &&
    option.decision.decision === "accept"
  );
}

export interface FamilyCard extends ApprovalCard {
  /** Set when only a grown-up may allow this; the sentence says why. */
  readonly grownUp: string | null;
}

/**
 * The card a child sees: never "allow for the session" or "always" (the engine would refuse
 * them without the code anyway), and on a card that needs a grown-up the Allow button says so.
 */
export function familyCard(card: ApprovalCard, grownUp: string | null): FamilyCard {
  const options = card.options
    .filter(
      (option) =>
        !(
          option.decision.type === "runtime-request.respond" &&
          "decision" in option.decision &&
          WIDENING.has(option.decision.decision)
        ),
    )
    .map((option) =>
      grownUp !== null && approves(option) ? { ...option, label: familyCopy.askGrownUp } : option,
    );
  return { ...card, options, grownUp };
}
