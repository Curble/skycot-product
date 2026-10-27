// `useShield()`: the gate a composer awaits before it sends while the Family profile is on.
// `clear` resolves at once for an ordinary message (or outside the profile); otherwise it
// shows the ShieldCard and resolves with what the child picked.
import type { MessageId } from "@t3tools/contracts";
import { shieldApprovalId } from "@t3tools/skycot-rules/personal";
import { useState } from "react";

import { newMessageId } from "~/lib/utils";

import { useFamily } from "../family/FamilyProvider";
import { reportShieldCatch } from "../recap/api";
import {
  pictureContentKey,
  rememberNoFacePictures,
  shieldFinding,
  unknownPictureKeysForChild,
  type ShieldFinding,
} from "./shield";
import { ShieldCard, type ShieldChoice } from "./ShieldCard";

export type ShieldOutcome =
  /** Send this text with this id (an id a grown-up may have allowed as typed). */
  | { readonly kind: "send"; readonly text: string; readonly messageId: MessageId }
  /** Back to the field; `dropPictures` when the child chose to take them out. */
  | { readonly kind: "edit"; readonly dropPictures: boolean };

interface Pending {
  readonly finding: ShieldFinding;
  readonly messageId: MessageId;
  readonly childId: string;
  readonly pictureKeys: ReadonlyArray<string | null>;
  readonly pictureNotice: string | null;
  readonly resolve: (outcome: ShieldOutcome) => void;
}

const picturesAskedByChild = new Map<string, Set<string>>();

export function useShield() {
  const family = useFamily();
  const [pending, setPending] = useState<Pending | null>(null);

  const clear = async (
    text: string,
    pictureData: ReadonlyArray<string> = [],
    pictureNotice: string | null = null,
  ): Promise<ShieldOutcome> => {
    const messageId = newMessageId();
    const childId = family.profile.currentChildId ?? "solo";
    const pictureKeys = await Promise.all(pictureData.map(pictureContentKey));
    const unknown = unknownPictureKeysForChild(pictureKeys, picturesAskedByChild, childId);
    const finding = family.enabled ? shieldFinding(text, unknown.length) : null;
    if (finding === null) return { kind: "send", text, messageId };
    // For the grown-up recap: the kinds of detail only, once per card.
    if (pending === null) reportShieldCatch(finding.categories);
    // A second Return while the card is up starts over with what is in the field now.
    pending?.resolve({ kind: "edit", dropPictures: false });
    return new Promise((resolve) =>
      setPending({ finding, messageId, childId, pictureKeys: unknown, pictureNotice, resolve }),
    );
  };

  const finish = (choice: ShieldChoice) => {
    if (pending === null) return;
    const { finding, messageId, childId, pictureKeys, resolve } = pending;
    setPending(null);
    if (choice.kind === "edit") resolve(choice);
    else {
      if (finding.hasPictures) {
        rememberNoFacePictures(picturesAskedByChild, childId, pictureKeys);
      }
      resolve({
        kind: "send",
        text: choice.kind === "nicknames" ? choice.text : finding.text,
        messageId,
      });
    }
  };

  const card =
    pending === null ? null : (
      <ShieldCard
        key={pending.messageId}
        finding={pending.finding}
        {...(pending.finding.hasPictures && pending.pictureNotice !== null
          ? { pictureNotice: pending.pictureNotice }
          : {})}
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
