// "How did you do that?" mode, per conversation and per browser. Off the record of the
// conversation on purpose: it changes what the assistant is asked, not what happened. The
// default follows the Family profile (on for a child, off otherwise); only a choice that
// differs from it is stored, so turning the profile on or off moves untouched conversations
// with it.
import { useSyncExternalStore } from "react";

import { explainDefault } from "@t3tools/skycot-rules/explain";

export const EXPLAIN_MODE_KEY = "skycot:explain-mode";

type Choices = Readonly<Record<string, boolean>>;

/** The stored choices; anything unreadable is no choice at all. */
export function parseExplainChoices(raw: string | null): Choices {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    );
  } catch {
    return {};
  }
}

export function explainOnFor(choices: Choices, threadId: string, familyOn: boolean): boolean {
  return choices[threadId] ?? explainDefault(familyOn);
}

/** The choices after one conversation's switch; a choice equal to the default is dropped. */
export function withExplainChoice(
  choices: Choices,
  threadId: string,
  on: boolean,
  familyOn: boolean,
): Choices {
  const { [threadId]: _previous, ...rest } = choices;
  return on === explainDefault(familyOn) ? rest : { ...rest, [threadId]: on };
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(EXPLAIN_MODE_KEY);
  } catch {
    return null;
  }
}

function writeChoices(choices: Choices) {
  try {
    if (Object.keys(choices).length === 0) window.localStorage.removeItem(EXPLAIN_MODE_KEY);
    else window.localStorage.setItem(EXPLAIN_MODE_KEY, JSON.stringify(choices));
  } catch {
    // Storage blocked: the default applies.
  }
  for (const listener of listeners) listener();
}

/** Whether this conversation's crew explains its changes, and the switch. */
export function useExplainMode(
  threadId: string,
  familyOn: boolean,
): readonly [boolean, (on: boolean) => void] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const on = explainOnFor(parseExplainChoices(raw), threadId, familyOn);
  const set = (next: boolean) =>
    writeChoices(withExplainChoice(parseExplainChoices(readRaw()), threadId, next, familyOn));
  return [on, set] as const;
}
