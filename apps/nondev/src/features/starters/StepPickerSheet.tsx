// The step picker: what a "Little maker" gets when they tap a starter card that has
// [blanks]. One big question at a time with eight picture tiles, plus two cards that are
// always there: "Surprise me" (a dice that picks a tile) and "Type it" (a keyboard for their
// own words). At the end they see the finished sentence and press "Make it!". Nothing is sent
// from here: Make it! hands the sentence to the composer exactly as a tap on a card does.
import { ArrowLeft, Dices, Keyboard } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { useCrew } from "../../themes/useCrew";
import { useFamily } from "../family/FamilyProvider";
import {
  choicesFor,
  fillBlanks,
  hasPicker,
  pickRandom,
  shownLabel,
  type BlankChoices,
} from "./choices";
import { seedFor, type ComposerSeed } from "./StarterCards";
import type { Starter } from "./starters";

/** How long a chosen tile stays in view before the next question slides in. */
export const ADVANCE_MS = 350;

type How = "tile" | "dice" | "typed";
interface Answer {
  readonly text: string;
  readonly how: How;
}

const CHIP_TONES = ["orange", "green", "blue", "purple"] as const;

export function StepPickerSheet({
  starter,
  onClose,
  onMake,
  random = Math.random,
}: {
  readonly starter: Starter;
  readonly onClose: () => void;
  readonly onMake: (text: string) => void;
  /** Injectable so the dice is testable; returns [0, 1). */
  readonly random?: () => number;
}) {
  const crewName = useCrew().builder.name;
  const steps = choicesFor(starter.id);
  const [answers, setAnswers] = useState<ReadonlyArray<Answer | null>>(() => steps.map(() => null));
  const [index, setIndex] = useState(0);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [rolls, setRolls] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  const final = index >= steps.length;
  const step: BlankChoices | undefined = steps[index];
  const answer = answers[index] ?? null;

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  // After the first move, keep focus inside the new screen rather than on a button that left.
  useEffect(() => {
    if (moved.current) stage.current?.focus();
    moved.current = true;
  }, [index]);

  const go = (to: number) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setTyping(false);
    setDraft("");
    setIndex(to);
  };
  const advanceSoon = (from: number) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setTyping(false);
      setDraft("");
      setIndex(from + 1);
    }, ADVANCE_MS);
  };
  const setAnswer = (value: Answer | null) =>
    setAnswers((current) => current.map((entry, i) => (i === index ? value : entry)));

  const sentence = fillBlanks(
    starter.ask,
    answers.map((entry) => entry?.text ?? null),
  );

  if (final) {
    const picked = steps.map((set, i) => {
      const entry = answers[i];
      const art =
        entry === null || entry === undefined
          ? "❓"
          : entry.how === "typed"
            ? "✏️"
            : (set.choices.find((choice) => choice.label === entry.text)?.art ?? "⭐");
      return { art, text: entry?.text ?? null };
    });
    return (
      <Sheet
        open
        wide
        onClose={onClose}
        title={`Here's what ${crewName} will make`}
        initialFocus="first"
        actions={
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
        }
      >
        <div className="fm-picker" data-screen="final">
          <div ref={stage} tabIndex={-1} className="fm-picker__stage">
            <BackButton onClick={() => go(steps.length - 1)} />
            <Dots total={steps.length} index={index} />
            <p className="fm-picker__sentence">{sentence}</p>
            <ul className="fm-picker__chips" aria-label="Your choices">
              {picked.map((chip, i) => (
                <li
                  key={steps[i]!.blankIndex}
                  className="fm-picker__chip"
                  data-tone={CHIP_TONES[i % CHIP_TONES.length]}
                >
                  <span aria-hidden>{chip.art}</span>
                  <span>{chip.text === null ? "Still to pick" : shownLabel(chip.text)}</span>
                </li>
              ))}
            </ul>
            <div className="fm-picker__final-actions">
              <Button variant="primary" size="lg" onClick={() => onMake(sentence)}>
                Make it!
              </Button>
              <Button variant="plain" size="lg" onClick={() => go(0)}>
                Change my mind
              </Button>
            </div>
          </div>
        </div>
      </Sheet>
    );
  }

  const chooseTile = (label: string) => {
    if (answer !== null && answer.how === "tile" && answer.text === label) {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      setAnswer(null);
      return;
    }
    setAnswer({ text: label, how: "tile" });
    advanceSoon(index);
  };
  const roll = () => {
    if (step === undefined) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setTyping(false);
    setAnswer({ text: pickRandom(step.choices, random).label, how: "dice" });
    setRolls((n) => n + 1);
  };
  const finishTyping = () => {
    const words = draft.trim();
    if (words === "") {
      setTyping(false);
      if (answer?.how === "typed") setAnswer(null);
      return;
    }
    setAnswer({ text: words, how: "typed" });
    setTyping(false);
    advanceSoon(index);
  };

  if (step === undefined) return null;
  return (
    <Sheet
      open
      wide
      onClose={onClose}
      title={step.question}
      initialFocus="first"
      actions={
        <Button variant="quiet" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="fm-picker" data-screen="step">
        <div ref={stage} tabIndex={-1} className="fm-picker__stage">
          {index > 0 ? <BackButton onClick={() => go(index - 1)} /> : null}
          <Dots total={steps.length} index={index} />
          <ul className="fm-picker__tiles">
            {step.choices.map((choice) => {
              const chosen =
                answer !== null && answer.how !== "typed" && answer.text === choice.label;
              return (
                <li key={`${choice.label}:${chosen && answer?.how === "dice" ? rolls : 0}`}>
                  <button
                    type="button"
                    className="fm-picker__tile"
                    aria-label={shownLabel(choice.label)}
                    aria-pressed={chosen}
                    data-chosen={chosen ? "" : undefined}
                    data-wobble={chosen && answer?.how === "dice" ? rolls : undefined}
                    onClick={() => chooseTile(choice.label)}
                  >
                    <span className="fm-picker__art" aria-hidden>
                      {choice.art}
                    </span>
                    <span className="fm-picker__label">{shownLabel(choice.label)}</span>
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                className="fm-picker__tile fm-picker__tile--special"
                aria-label={answer?.how === "dice" ? "Surprise me, roll again" : "Surprise me"}
                aria-pressed={answer?.how === "dice"}
                data-chosen={answer?.how === "dice" ? "" : undefined}
                onClick={roll}
              >
                <span className="fm-picker__art" aria-hidden>
                  <Dices size={44} strokeWidth={1.8} />
                </span>
                <span className="fm-picker__label">
                  {answer?.how === "dice" ? "Roll again" : "Surprise me"}
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="fm-picker__tile fm-picker__tile--special"
                aria-label="Type it"
                aria-expanded={typing}
                data-chosen={answer?.how === "typed" ? "" : undefined}
                onClick={() => {
                  setTyping(true);
                  setDraft(answer?.how === "typed" ? answer.text : "");
                }}
              >
                <span className="fm-picker__art" aria-hidden>
                  <Keyboard size={44} strokeWidth={1.8} />
                </span>
                <span className="fm-picker__label">
                  {answer?.how === "typed" ? shownLabel(answer.text) : "Type it"}
                </span>
              </button>
            </li>
          </ul>
          {typing ? (
            <form
              className="fm-picker__type"
              onSubmit={(event) => {
                event.preventDefault();
                finishTyping();
              }}
            >
              <label className="fm-picker__type-label" htmlFor="fm-picker-type">
                Type your own answer
              </label>
              <div className="fm-picker__type-row">
                <input
                  id="fm-picker-type"
                  className="fm-picker__input"
                  type="text"
                  value={draft}
                  maxLength={80}
                  // oxlint-disable-next-line jsx-a11y/no-autofocus -- they just tapped Type it
                  autoFocus
                  autoComplete="off"
                  onChange={(event) => setDraft(event.target.value)}
                />
                <Button type="submit" variant="primary" size="lg">
                  Done
                </Button>
              </div>
            </form>
          ) : null}
          {answer !== null && !typing ? (
            <div className="fm-picker__next">
              <Button variant="primary" size="lg" onClick={() => go(index + 1)}>
                Next
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}

function BackButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <button type="button" className="fm-picker__back" aria-label="Back" onClick={onClick}>
      <ArrowLeft size={22} strokeWidth={2.2} aria-hidden />
      <span>Back</span>
    </button>
  );
}

function Dots({ total, index }: { readonly total: number; readonly index: number }) {
  if (total < 2) return null;
  return (
    <div className="fm-picker__dots" role="img" aria-label={`Step ${index + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} data-state={i < index ? "done" : i === index ? "now" : "next"} />
      ))}
    </div>
  );
}

/**
 * Card taps, for Home and an empty conversation. A Little maker's card with [blanks] opens
 * the step picker; every other tap fills the box as before. `sheet` goes in the screen.
 * Make it! hands over the finished sentence with `sendNow` and closes the picker; the two
 * composers then send it exactly as if Send were pressed (and keep it in the box if refused).
 */
export function useStarterPick(setSeed: (seed: ComposerSeed) => void): {
  readonly pick: (starter: Starter) => void;
  readonly sheet: ReactNode;
} {
  const family = useFamily();
  const child = family.profile.children.find((entry) => entry.id === family.profile.currentChildId);
  const little = child?.readingLevel === "little-makers";
  const [open, setOpen] = useState<Starter | null>(null);
  const pick = (starter: Starter) => {
    const askPicture = () => {
      // The file picker only opens inside the tap itself (a browser needs a user gesture).
      if (starter.kind === "picture") {
        document.querySelector<HTMLInputElement>(".fm-composer__file")?.click();
      }
    };
    if (little && starter.audience === "kids" && hasPicker(starter.id)) {
      askPicture();
      setOpen(starter);
      return;
    }
    setSeed(seedFor(starter));
    askPicture();
  };
  const sheet =
    open === null ? null : (
      <StepPickerSheet
        key={open.id}
        starter={open}
        onClose={() => setOpen(null)}
        onMake={(text) => {
          setSeed({ ...seedFor(open), text, sendNow: true });
          setOpen(null);
        }}
      />
    );
  return { pick, sheet };
}
