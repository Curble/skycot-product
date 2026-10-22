import { useFamily } from "../family/FamilyProvider";
import { childLabel } from "../family/children";
import { childFirst, type ChildOrder } from "./order";
import { useLimits } from "./store";

/**
 * The list split for the child using SKYCOT here, or null when there is nothing to split (no
 * Family profile, one child, nobody chosen yet). `title` names the first part.
 */
export function useChildFirst<R>(
  rows: ReadonlyArray<R>,
  threadIdOf: (row: R) => string,
): (ChildOrder<R> & { readonly title: string }) | null {
  const family = useFamily();
  const { today } = useLimits();
  const view = family.profile;
  if (!family.enabled || view.children.length < 2) return null;
  const order = childFirst(rows, threadIdOf, today.threads, view.currentChildId);
  if (order === null) return null;
  const index = view.children.findIndex((child) => child.id === view.currentChildId);
  const child = view.children[index];
  return { ...order, title: child ? `${childLabel(child, index)}'s` : "Yours" };
}
