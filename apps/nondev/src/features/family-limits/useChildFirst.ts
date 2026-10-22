import { useEffect } from "react";

import { useFamily } from "../family/FamilyProvider";
import { childLabel } from "../family/children";

import { childFirst, unknownThreadIds, type ChildOrder } from "./order";
import { askWhoStarted, useLimits } from "./store";

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
  const splitting = family.enabled && view.children.length >= 2;
  const unknown = splitting ? unknownThreadIds(rows, threadIdOf, today.threads).join(" ") : "";
  // A conversation started here (or on another device) since the last read is someone's.
  useEffect(() => {
    if (unknown.length > 0) askWhoStarted(unknown.split(" "));
  }, [unknown]);
  if (!splitting) return null;
  const order = childFirst(rows, threadIdOf, today.threads, view.currentChildId);
  if (order === null) return null;
  const index = view.children.findIndex((child) => child.id === view.currentChildId);
  const child = view.children[index];
  return { ...order, title: child ? `${childLabel(child, index)}'s` : "Yours" };
}
