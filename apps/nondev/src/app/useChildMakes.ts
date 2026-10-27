// The child's own makes, newest first: the rows "Things I made" and the sidebar's count share.
// Only the child's conversations (the engine records who started what), live and put away.
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { rowsForChild } from "../features/family-limits/order";
import { useLimits } from "../features/family-limits/store";
import { useFamily } from "../features/family/FamilyProvider";
import { conversationRowsAtom, type ConversationRow } from "../state/conversations";
import { oldConversationRowsAtom } from "../state/oldConversations";
import { useChildView } from "./useChildView";

const NO_ROWS = Atom.make<ReadonlyArray<ConversationRow>>([]).pipe(
  Atom.withLabel("nondev-child-makes:no-rows"),
);

export function useChildMakes(): ReadonlyArray<ConversationRow> {
  const childView = useChildView();
  const family = useFamily();
  const { today } = useLimits();
  const rows = useAtomValue(conversationRowsAtom);
  const archived = useAtomValue(childView ? oldConversationRowsAtom : NO_ROWS);
  if (!childView) return [];
  const childId =
    family.profile.me.kind === "child" ? family.profile.me.childId : family.profile.currentChildId;
  const own = rowsForChild([...rows, ...archived], (row) => row.shell.id, today.threads, childId);
  return [...own].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
