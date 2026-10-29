// Card taps, for Home and an empty conversation. Every kids' card with blanks opens build help
// (Pictures, Words or Builder). The first tap is the "choose your path" screen; the child's pick
// is remembered on their profile in the engine, and later taps open straight into it. "Change
// how I build" in each level's header reopens the chooser; "Just type it myself" skips build
// help and puts the card's plain sentence in the box, as a tap on a card always did. Make it!
// hands over the finished sentence with `sendNow` and closes the sheet; the two composers then
// send it exactly as if Send were pressed (and keep it in the box if refused).
import { useState, type ReactNode } from "react";

import { useCrew } from "../../themes/useCrew";
import { useFamily } from "../family/FamilyProvider";
import { saveOwnBuildHelp } from "../family/store";
import { BuilderSheet } from "./BuilderSheet";
import { firstScreen, hasBuildHelp, type BuildHelp, type BuildHelpScreen } from "./buildHelp";
import { ChooserSheet } from "./ChooserSheet";
import { recipeFor } from "./recipes";
import { seedFor, type ComposerSeed } from "./StarterCards";
import { StepPickerSheet } from "./StepPickerSheet";
import type { Starter } from "./starters";
import { WordsSheet } from "./WordsSheet";
import { wordsPlanFor } from "./wordChoices";

export function BuildHelpSheet({
  starter,
  initial,
  stored,
  suggested,
  onChoose,
  onMake,
  onTypeMyself,
  onClose,
  random,
}: {
  readonly starter: Starter;
  readonly initial: BuildHelpScreen;
  /** What the child chose before (null the first time). */
  readonly stored: BuildHelp | null;
  /** The level the age band suggests. */
  readonly suggested: BuildHelp;
  /** The child picked a level on the chooser: remember it. */
  readonly onChoose: (level: BuildHelp) => void;
  readonly onMake: (text: string) => void;
  readonly onTypeMyself: () => void;
  readonly onClose: () => void;
  readonly random?: () => number;
}) {
  const crewName = useCrew().builder.name;
  const [screen, setScreen] = useState<BuildHelpScreen>(initial);
  const [chosen, setChosen] = useState<BuildHelp | null>(stored);
  const changeHow = () => setScreen("chooser");

  if (screen === "chooser") {
    return (
      <ChooserSheet
        crewName={crewName}
        stored={chosen}
        suggested={suggested}
        onPick={(level) => {
          setChosen(level);
          onChoose(level);
          setScreen(level);
        }}
        onTypeMyself={onTypeMyself}
        onClose={onClose}
      />
    );
  }
  if (screen === "words") {
    const plan = wordsPlanFor(starter.id);
    if (plan !== undefined) {
      return (
        <WordsSheet
          key="words"
          starterId={starter.id}
          plan={plan}
          crewName={crewName}
          onClose={onClose}
          onMake={onMake}
          onChangeHow={changeHow}
          onTypeMyself={onTypeMyself}
          {...(random === undefined ? {} : { random })}
        />
      );
    }
  }
  if (screen === "builder") {
    const recipe = recipeFor(starter.id);
    if (recipe !== undefined) {
      return (
        <BuilderSheet
          key="builder"
          starterId={starter.id}
          recipe={recipe}
          onClose={onClose}
          onSend={onMake}
          onChangeHow={changeHow}
          onTypeMyself={onTypeMyself}
        />
      );
    }
  }
  return (
    <StepPickerSheet
      key="pictures"
      starter={starter}
      onClose={onClose}
      onMake={onMake}
      onChangeHow={changeHow}
      onTypeMyself={onTypeMyself}
      {...(random === undefined ? {} : { random })}
    />
  );
}

/**
 * `pick` is what a card tap calls and `sheet` goes in the screen. A kids' card with blanks, for a
 * child using SKYCOT, opens build help; every other tap fills the box as before.
 */
export function useStarterPick(setSeed: (seed: ComposerSeed) => void): {
  readonly pick: (starter: Starter) => void;
  readonly sheet: ReactNode;
} {
  const family = useFamily();
  const child = family.profile.children.find((entry) => entry.id === family.profile.currentChildId);
  // What the child picked this time round, until the engine's answer comes back with it.
  const [chosen, setChosen] = useState<{
    readonly childId: string;
    readonly level: BuildHelp;
  } | null>(null);
  const [open, setOpen] = useState<{
    readonly starter: Starter;
    readonly screen: BuildHelpScreen;
    readonly suggested: BuildHelp;
    readonly stored: BuildHelp | null;
  } | null>(null);

  const pick = (starter: Starter) => {
    const askPicture = () => {
      // The file picker only opens inside the tap itself (a browser needs a user gesture).
      if (starter.kind === "picture") {
        document.querySelector<HTMLInputElement>(".fm-composer__file")?.click();
      }
    };
    if (
      family.enabled &&
      child !== undefined &&
      starter.audience === "kids" &&
      hasBuildHelp(starter.id)
    ) {
      const stored =
        chosen !== null && chosen.childId === child.id ? chosen.level : (child.buildHelp ?? null);
      const { screen, suggested } = firstScreen({ stored, band: child.readingLevel });
      askPicture();
      setOpen({ starter, screen, suggested, stored });
      return;
    }
    setSeed(seedFor(starter));
    askPicture();
  };
  const sheet =
    open === null || child === undefined ? null : (
      <BuildHelpSheet
        key={open.starter.id}
        starter={open.starter}
        initial={open.screen}
        stored={open.stored}
        suggested={open.suggested}
        onChoose={(level) => {
          setChosen({ childId: child.id, level });
          void saveOwnBuildHelp(level);
        }}
        onClose={() => setOpen(null)}
        onTypeMyself={() => {
          setSeed(seedFor(open.starter));
          setOpen(null);
        }}
        onMake={(text) => {
          setSeed({ ...seedFor(open.starter), text, sendNow: true });
          setOpen(null);
        }}
      />
    );
  return { pick, sheet };
}
