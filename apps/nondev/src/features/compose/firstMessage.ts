// What a new conversation is called, and what its private copy's branch is named, from the
// first message the shield let through. Both are made from the nicknamed words: a grown-up
// who let a full name go "as typed" let it reach the assistant once, not into a title or a
// branch name that stays in the sidebar and the project's history.
import { rewriteWithNicknames } from "@t3tools/skycot-rules/personal";

import { branchNameFor } from "./privateCopy";

export function titleSeedFrom(text: string): string {
  const line =
    text
      .split(/\r?\n/)
      .find((part) => part.trim().length > 0)
      ?.trim() ?? "New conversation";
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}

export function firstMessageLabels(
  text: string,
  token: string,
  familyOn: boolean,
): { readonly title: string; readonly branch: string } {
  const safe = familyOn ? rewriteWithNicknames(text) : text;
  return { title: titleSeedFrom(safe), branch: branchNameFor(safe, token) };
}
