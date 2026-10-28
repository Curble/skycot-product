// Which ways the asleep screen offers for getting more time: the parent code typed right here,
// and/or a request sent to the grown-ups' linked phones. Pure: the screen only shows the answer.
import type { FamilyDeviceSummary, FamilyGrownUp, FamilyMe } from "../family/people";

export type MoreTimeWay = "code" | "phone";

/** True when at least one grown-up has a linked phone (a grown-up device the engine lists). */
export function grownUpPhonesLinked(
  grownUps: ReadonlyArray<FamilyGrownUp>,
  devices: ReadonlyArray<FamilyDeviceSummary>,
): boolean {
  return devices.some(
    (device) =>
      device.kind === "grown-up" && grownUps.some((person) => person.id === device.personId),
  );
}

/**
 * - Not a child view: the code box only (as before).
 * - A child's own device: the phone request only (as before).
 * - The shared family Mac: the code box, plus the phone request when a phone is linked.
 */
export function moreTimeWays(input: {
  readonly me: FamilyMe;
  readonly grownUpPhonesLinked: boolean;
  readonly childView: boolean;
}): ReadonlyArray<MoreTimeWay> {
  if (!input.childView) return ["code"];
  if (input.me.kind !== "shared") return ["phone"];
  return input.grownUpPhonesLinked ? ["code", "phone"] : ["code"];
}
