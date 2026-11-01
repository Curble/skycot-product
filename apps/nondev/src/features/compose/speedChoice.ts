// Speed boost: "Normal / Faster / Fastest" for the next message of one conversation.
// The wording and the mapping from the assistant's own speed option come from
// plain/autonomy.ts (`describeSpeedCare`); this file decides when the control exists, what is
// remembered, and what rides in the model selection. A faster tier costs more of the plan, so
// every faster stop says so, and the control only exists where the model really offers one
// (Fastest only when the assistant has a third tier).
//
// Not offered while the Family profile is on: the engine runs every turn at normal speed there
// (SkycotFamilyInstructions.familyModelSelection), so a control would promise something that
// cannot happen. Undo is choosing the usual setting again, which forgets the choice.
import type { ModelSelection, ProviderOptionDescriptor } from "@t3tools/contracts";
import { isSpeedOptionId } from "@t3tools/skycot-rules/speed";
import { useSyncExternalStore } from "react";

import { describeSpeedCare, type SpeedLevel, type TraitMapping } from "../../plain/autonomy";
import { grownUpControlsShown } from "./depthChoice";

export const SPEED_BOOST_KEY = "skycot:speed-boost";

export interface SpeedModel {
  readonly speed: TraitMapping<SpeedLevel>;
  /** The stop the assistant uses when nothing is chosen. */
  readonly usual: SpeedLevel;
  /** An on/off option (Claude's fast mode) takes true or false, not a word. */
  readonly isBoolean: boolean;
}

/** Plain cost wording for each faster stop. */
export const speedCosts: Readonly<Record<SpeedLevel, string | undefined>> = {
  normal: undefined,
  fast: "Faster replies. Uses more of your plan.",
  fastest: "The quickest replies. Uses the most of your plan.",
};

/**
 * The control's model, or null when it should not be shown: a child, the Family profile, or an
 * assistant/model with no speed option (or nothing faster to choose).
 */
export function speedModelFor(
  descriptors: ReadonlyArray<ProviderOptionDescriptor> | undefined,
  who: { readonly childView: boolean; readonly familyOn: boolean },
): SpeedModel | null {
  if (!grownUpControlsShown(who)) return null;
  const speed = describeSpeedCare(descriptors).speed;
  if (speed === undefined || speed.choices.length < 2) return null;
  const usual =
    speed.choices.find((choice) => choice.isDefault)?.level ??
    speed.current ??
    speed.choices.find((choice) => choice.level === "normal")?.level ??
    speed.choices[0]!.level;
  const isBoolean = (descriptors ?? []).some(
    (descriptor) => descriptor.id === speed.optionId && descriptor.type === "boolean",
  );
  return { speed, usual, isBoolean };
}

/** The stop shown: the remembered one if this model still has it, else the usual. */
export function shownSpeed(model: SpeedModel, remembered: SpeedLevel | undefined): SpeedLevel {
  return remembered !== undefined && model.speed.choices.some((c) => c.level === remembered)
    ? remembered
    : model.usual;
}

/**
 * The model selection to send. The usual stop sends the selection untouched (the assistant's
 * own default); any other stop sets the speed option and keeps every other option.
 */
export function selectionWithSpeed(
  selection: ModelSelection,
  model: SpeedModel | null,
  remembered: SpeedLevel | undefined,
): ModelSelection {
  if (model === null) return selection;
  const level = shownSpeed(model, remembered);
  if (level === model.usual) return selection;
  const choice = model.speed.choices.find((entry) => entry.level === level);
  if (choice === undefined) return selection;
  const others = (selection.options ?? []).filter((option) => !isSpeedOptionId(option.id));
  const value = model.isBoolean ? choice.value === "true" : choice.value;
  return { ...selection, options: [...others, { id: model.speed.optionId, value }] };
}

// ---- remembered per conversation, per browser -------------------------------------------

type Choices = Readonly<Record<string, SpeedLevel>>;
const LEVELS: ReadonlyArray<SpeedLevel> = ["normal", "fast", "fastest"];

export function parseSpeedChoices(raw: string | null): Choices {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, SpeedLevel] =>
        LEVELS.includes(entry[1] as SpeedLevel),
      ),
    );
  } catch {
    return {};
  }
}

/** The choices after one conversation's pick; the usual stop forgets the choice. */
export function withSpeedChoice(
  choices: Choices,
  threadId: string,
  level: SpeedLevel,
  usual: SpeedLevel,
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
    return window.localStorage.getItem(SPEED_BOOST_KEY);
  } catch {
    return null;
  }
}
function writeChoices(choices: Choices) {
  try {
    if (Object.keys(choices).length === 0) window.localStorage.removeItem(SPEED_BOOST_KEY);
    else window.localStorage.setItem(SPEED_BOOST_KEY, JSON.stringify(choices));
  } catch {
    // Storage blocked: the usual setting applies.
  }
  for (const listener of listeners) listener();
}

export function useRememberedSpeed(
  threadId: string,
): readonly [SpeedLevel | undefined, (level: SpeedLevel, usual: SpeedLevel) => void] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const remembered = parseSpeedChoices(raw)[threadId];
  const set = (level: SpeedLevel, usual: SpeedLevel) =>
    writeChoices(withSpeedChoice(parseSpeedChoices(readRaw()), threadId, level, usual));
  return [remembered, set] as const;
}

export const speedCopy = {
  label: "Speed",
  intro:
    "How fast the assistant answers. Faster replies use more of your plan. Applies to your next message.",
  usual: "Usual setting",
} as const;
