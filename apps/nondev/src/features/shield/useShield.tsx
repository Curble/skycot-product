// `useShield()`: the gate a composer awaits before it sends while the Family profile is on.
// `clear` resolves at once for an ordinary message (or outside the profile); otherwise it
// shows the ShieldCard and resolves with what the child picked.
import type { MessageId } from "@t3tools/contracts";
import { shieldApprovalId } from "@t3tools/skycot-rules/personal";
import { useState } from "react";

import { newMessageId } from "~/lib/utils";

import { useFamily } from "../family/FamilyProvider";
import { reportShieldCatch } from "../recap/api";
import { shieldFinding, type ShieldFinding } from "./shield";
import { ShieldCard, type ShieldChoice } from "./ShieldCard";

export type ShieldOutcome =
  /** Send this text with this id (an id a grown-up may have allowed as typed). */
  | { readonly kind: "send"; readonly text: string; readonly messageId: MessageId }
  /** Back to the field; `dropPictures` when the child chose to take them out. */
  | { readonly kind: "edit"; readonly dropPictures: boolean };

interface Pending {
  readonly finding: ShieldFinding;
  readonly messageId: MessageId;
  readonly resolve: (outcome: ShieldOutcome) => void;
}

export function useShield() {
  const family = useFamily();
  const [pending, setPending] = useState<Pending | null>(null);

  const clear = (text: string, pictureCount = 0): Promise<ShieldOutcome> => {
    const messageId = newMessageId();
    const finding = family.enabled ? shieldFinding(text, pictureCount) : null;
    if (finding === null) return Promise.resolve({ kind: "send", text, messageId });
    // For the grown-up recap: the kinds of detail only, once per card.
    if (pending === null) reportShieldCatch(finding.categories);
    // A second Return while the card is up starts over with what is in the field now.
    pending?.resolve({ kind: "edit", dropPictures: false });
    return new Promise((resolve) => setPending({ finding, messageId, resolve }));
  };

  const finish = (choice: ShieldChoice) => {
    if (pending === null) return;
    const { finding, messageId, resolve } = pending;
    setPending(null);
    if (choice.kind === "edit") resolve(choice);
    else
      resolve({
        kind: "send",
        text: choice.kind === "nicknames" ? choice.text : finding.text,
        messageId,
      });
  };

  const card =
    pending === null ? null : (
      <ShieldCard
        key={pending.messageId}
        finding={pending.finding}
        onChoose={finish}
        onAskGrownUp={() =>
          family.requireParentCode("approve", {
            requestId: shieldApprovalId(pending.messageId),
            reason: pending.finding.reason,
          })
        }
      />
    );

  return { clear, card, open: pending !== null };
}
