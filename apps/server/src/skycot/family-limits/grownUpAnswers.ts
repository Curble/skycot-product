// Who answered a child's held request, in the words the child sees: "Mum said yes · 8:42".
//
// The family log already keeps each grown-up answer (SkycotFamilyDevices for a phone or Watch,
// SkycotFamilyGate for the parent code on the Mac). A child's screen gets only the answering
// grown-up's first name and the time, never a device, a Watch name or how they proved it. The
// parent code is shared, so a yes typed on the Mac has no name: "A grown-up said yes".

import type { FamilyGrownUp } from "../SkycotFamily.ts";
import type { FamilyEvent } from "./SkycotFamilyLimits.ts";

export interface GrownUpAnswer {
  readonly requestId: string;
  readonly decision: "accept" | "decline";
  /** The grown-up's first name, or null when the parent code answered. */
  readonly by: string | null;
  readonly at: number;
}

function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/u)[0];
  return first === undefined || first.length === 0 ? null : first;
}

/** The grown-up answers in one conversation, newest last; the latest answer per request wins. */
export function grownUpAnswersFor(
  events: ReadonlyArray<FamilyEvent>,
  threadId: string,
  grownUps: ReadonlyArray<Pick<FamilyGrownUp, "id" | "name">>,
): ReadonlyArray<GrownUpAnswer> {
  const byRequest = new Map<string, GrownUpAnswer>();
  for (const event of events) {
    if (event.threadId !== threadId || event.requestId === undefined) continue;
    if (event.kind !== "approved" && event.kind !== "declined") continue;
    const person =
      event.by === undefined
        ? undefined
        : grownUps.find((entry) => entry.id === event.by!.personId);
    byRequest.set(event.requestId, {
      requestId: event.requestId,
      decision: event.kind === "approved" ? "accept" : "decline",
      by: event.by === undefined ? null : (firstName(person?.name) ?? null),
      at: event.at,
    });
  }
  return [...byRequest.values()].sort((left, right) => left.at - right.at);
}
