// Settings › AI assistants › Use by default, pure part: which rows the picker shows, which one
// is ticked, and the plain sentences under it. Only assistants that are installed and signed
// in can be picked; a chosen one that later needs signing in again stays listed, honestly
// marked, while new conversations use the automatic pick until it is back.
import type { ModelSelection, ServerProvider } from "@t3tools/contracts";

import {
  automaticModelSelection,
  isReadyProvider,
  providerForSelection,
  resolveDefaultModelSelection,
  usableChosenSelection,
  type DefaultAssistantPreference,
} from "../../state/providers";
import { catalogEntryFor, statusSentence } from "./providerCatalog";

export const AUTOMATIC = "automatic";

export interface DefaultChoiceRow {
  /** `AUTOMATIC`, or the provider instance id. */
  readonly value: string;
  readonly driver: string | null;
  readonly title: string;
  readonly subtitle: string;
  /** Null for Automatic, which writes null. */
  readonly selection: ModelSelection | null;
  readonly disabled: boolean;
}

export interface DefaultChoiceModel {
  readonly rows: ReadonlyArray<DefaultChoiceRow>;
  /** The ticked row's value. */
  readonly checked: string;
  /** The brand new conversations start with now, or null when none can run. */
  readonly inUse: string | null;
  /** True when the person picked one but it can't be used right now. */
  readonly chosenUnavailable: boolean;
}

function selectionFor(provider: ServerProvider, chosen: ModelSelection | null): ModelSelection {
  // Keep the person's (or Advanced mode's) model for the same assistant when it is still offered.
  if (
    chosen !== null &&
    chosen.instanceId === provider.instanceId &&
    provider.models.some((model) => model.slug === chosen.model)
  ) {
    return chosen;
  }
  const model = provider.models.find((entry) => entry.isDefault) ?? provider.models[0]!;
  return { instanceId: provider.instanceId, model: model.slug };
}

export function defaultChoiceModel(
  providers: ReadonlyArray<ServerProvider> | null,
  preference: DefaultAssistantPreference,
): DefaultChoiceModel {
  const list = providers ?? [];
  const chosen = preference.chosen;
  const allowed = (provider: ServerProvider) =>
    preference.mayUse ? preference.mayUse(String(provider.driver)) : true;
  // One row per assistant: the chosen instance when it is ready, else the first ready one.
  const pickable = new Map<string, ServerProvider>();
  for (const provider of list) {
    if (!provider.enabled || provider.models.length === 0) continue;
    if (!isReadyProvider(provider) || !allowed(provider)) continue;
    const driver = String(provider.driver);
    const existing = pickable.get(driver);
    if (!existing || provider.instanceId === chosen?.instanceId) pickable.set(driver, provider);
  }

  const inUseSelection = resolveDefaultModelSelection(providers, null, preference);
  const inUseProvider = providerForSelection(providers, inUseSelection);
  const inUse = inUseProvider ? catalogEntryFor(String(inUseProvider.driver)).brand : null;
  const automaticProvider = providerForSelection(providers, automaticModelSelection(providers));
  const automaticBrand =
    automaticProvider && allowed(automaticProvider)
      ? catalogEntryFor(String(automaticProvider.driver)).brand
      : null;

  const rows: Array<DefaultChoiceRow> = [
    {
      value: AUTOMATIC,
      driver: null,
      title: "Automatic",
      subtitle: automaticBrand
        ? `The first assistant that is ready. Right now that's ${automaticBrand}.`
        : "The first assistant that is ready.",
      selection: null,
      disabled: false,
    },
  ];
  for (const provider of pickable.values()) {
    const entry = catalogEntryFor(String(provider.driver));
    rows.push({
      value: String(provider.instanceId),
      driver: String(provider.driver),
      title: entry.brand,
      subtitle: `${entry.runs}. ${statusSentence(provider)}`,
      selection: selectionFor(provider, chosen),
      disabled: false,
    });
  }

  const chosenProvider = providerForSelection(providers, chosen);
  const chosenUsable = usableChosenSelection(providers, preference) !== null;
  const chosenListed =
    chosenProvider !== null && rows.some((row) => row.value === String(chosenProvider.instanceId));
  if (chosen !== null && !chosenListed) {
    // The pick is kept (it comes back when the assistant does), so the row says why it waits.
    const driver = chosenProvider ? String(chosenProvider.driver) : null;
    const entry = driver ? catalogEntryFor(driver) : null;
    const reason: string =
      chosenProvider === null
        ? "Not on this Mac right now."
        : !allowed(chosenProvider)
          ? "Not allowed for the Family profile."
          : statusSentence(chosenProvider);
    rows.push({
      value: chosenProvider ? String(chosenProvider.instanceId) : String(chosen.instanceId),
      driver,
      title: entry ? entry.brand : "The assistant you picked",
      subtitle: chosenUsable
        ? `${entry ? `${entry.runs}. ` : ""}${reason}`
        : inUse
          ? `${reason} New conversations use ${inUse} until then.`
          : reason,
      selection: chosen,
      // Still in use (it only reports a warning): it stays an ordinary choice.
      disabled: !chosenUsable,
    });
  }

  const checked =
    chosen === null
      ? AUTOMATIC
      : (rows.find((row) => row.value === String(chosen.instanceId))?.value ?? AUTOMATIC);
  return { rows, checked, inUse, chosenUnavailable: chosen !== null && !chosenUsable };
}

/** The footnote under the picker. */
export function defaultChoiceFooter(
  model: DefaultChoiceModel,
  options: { readonly familyOn: boolean; readonly advancedLabel: string },
): string {
  const start = model.inUse
    ? `New conversations start with ${model.inUse}. You can still pick another one for a single conversation in ${options.advancedLabel}.`
    : "Once an assistant is ready it will be used for new conversations.";
  return options.familyOn ? `${start} Changing this asks for the parent code.` : start;
}
