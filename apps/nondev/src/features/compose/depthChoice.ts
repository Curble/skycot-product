// Thinking depth: "Quick / Balanced / Careful" for the next message of one conversation.
// The wording and the mapping from the assistant's own effort option come from
// plain/autonomy.ts (`describeSpeedCare`); this file decides when the control exists, what is
// remembered, and what rides in the model selection.
//
// Not offered while the Family profile is on: the engine runs every turn at the assistant's own
// default there (SkycotFamilyInstructions.familyModelSelection), so a control would promise
// something that cannot happen. Only the Advanced-mode grown-up keeps a choice, and that screen
// is not this one. Undo is choosing the usual setting again, which forgets the choice.
import type { ModelSelection, ProviderOptionDescriptor, ServerProvider } from "@t3tools/contracts";
import { isEffortOptionId } from "@t3tools/skycot-rules/depth";
import { useSyncExternalStore } from "react";

import { describeSpeedCare, type CareLevel, type TraitMapping } from "../../plain/autonomy";

export const THINKING_DEPTH_KEY = "skycot:thinking-depth";

export interface DepthModel {
  readonly care: TraitMapping<CareLevel>;
  /** The stop the assistant uses when nothing is chosen. */
  readonly usual: CareLevel;
}

/** The effort options the chosen model offers, if any. */
export function descriptorsFor(
  providers: ReadonlyArray<ServerProvider> | null,
  selection: Pick<ModelSelection, "instanceId" | "model"> | null,
): ReadonlyArray<ProviderOptionDescriptor> | undefined {
  if (providers === null || selection === null) return undefined;
  const provider = providers.find((entry) => entry.instanceId === selection.instanceId);
  return provider?.models.find((model) => model.slug === selection.model)?.capabilities
    ?.optionDescriptors;
}

/** Grown-up-only controls (thinking depth, the command palette): never a child's, never with Family on. */
export function grownUpControlsShown(who: {
  readonly childView: boolean;
  readonly familyOn: boolean;
}): boolean {
  return !who.childView && !who.familyOn;
}

/**
 * The control's model, or null when it should not be shown: a child, the Family profile, or an
 * assistant/model with no effort option (or only one stop to choose).
 */
export function depthModelFor(
  descriptors: ReadonlyArray<ProviderOptionDescriptor> | undefined,
  who: { readonly childView: boolean; readonly familyOn: boolean },
): DepthModel | null {
  if (!grownUpControlsShown(who)) return null;
  const care = describeSpeedCare(descriptors).care;
  if (care === undefined || care.choices.length < 2) return null;
  const usual =
    care.choices.find((choice) => choice.isDefault)?.level ??
    care.current ??
    care.choices.find((choice) => choice.level === "balanced")?.level ??
    care.choices[0]!.level;
  return { care, usual };
}

/** The stop shown: the remembered one if this model still has it, else the usual. */
export function shownDepth(model: DepthModel, remembered: CareLevel | undefined): CareLevel {
  return remembered !== undefined && model.care.choices.some((c) => c.level === remembered)
    ? remembered
    : model.usual;
}

/**
 * The model selection to send. The usual stop sends the selection untouched (the assistant's
 * own default); any other stop sets the effort option and keeps every other option.
 */
export function selectionWithDepth(
  selection: ModelSelection,
  model: DepthModel | null,
  remembered: CareLevel | undefined,
): ModelSelection {
  if (model === null) return selection;
  const level = shownDepth(model, remembered);
  if (level === model.usual) return selection;
  const choice = model.care.choices.find((entry) => entry.level === level);
  if (choice === undefined) return selection;
  const others = (selection.options ?? []).filter((option) => !isEffortOptionId(option.id));
  return {
    ...selection,
    options: [...others, { id: model.care.optionId, value: choice.value }],
  };
}

// ---- remembered per conversation, per browser -------------------------------------------

type Choices = Readonly<Record<string, CareLevel>>;
const LEVELS: ReadonlyArray<CareLevel> = ["careful", "balanced", "quick"];

export function parseDepthChoices(raw: string | null): Choices {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, CareLevel] =>
        LEVELS.includes(entry[1] as CareLevel),
      ),
    );
  } catch {
    return {};
  }
}

/** The choices after one conversation's pick; the usual stop forgets the choice. */
export function withDepthChoice(
  choices: Choices,
  threadId: string,
  level: CareLevel,
  usual: CareLevel,
): Choices {
  const { [threadId]: _previous, ...rest } = choices;
  return level === usual ? rest : { ...rest, [threadId]: level };
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
    return window.localStorage.getItem(THINKING_DEPTH_KEY);
  } catch {
    return null;
  }
}
function writeChoices(choices: Choices) {
  try {
    if (Object.keys(choices).length === 0) window.localStorage.removeItem(THINKING_DEPTH_KEY);
    else window.localStorage.setItem(THINKING_DEPTH_KEY, JSON.stringify(choices));
  } catch {
    // Storage blocked: the usual setting applies.
  }
  for (const listener of listeners) listener();
}

export function useRememberedDepth(
  threadId: string,
): readonly [CareLevel | undefined, (level: CareLevel, usual: CareLevel) => void] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const remembered = parseDepthChoices(raw)[threadId];
  const set = (level: CareLevel, usual: CareLevel) =>
    writeChoices(withDepthChoice(parseDepthChoices(readRaw()), threadId, level, usual));
  return [remembered, set] as const;
}

export const depthCopy = {
  label: "Thinking depth",
  intro: "How long the assistant thinks before it answers. Applies to your next message.",
  usual: "Usual setting",
} as const;
