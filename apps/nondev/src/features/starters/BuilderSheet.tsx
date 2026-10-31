// The Builder level of build help: a short recipe checklist of parts (score, levels, sounds,
// timer...), then the whole sentence opens as a text box the child can change, and Send. The
// parts they ticked become one "Also add: ..." sentence after the card's own words. Send is the
// child's own press after reading it, so the message is handed over like Make it! does.
import { ArrowLeft, Minus, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { choicesFor } from "./choices";
import { ChangeHowButton, SamArt, TypeMyselfLink } from "./BuildHelpParts";
import { exampleBlank, itemPhrase, recipeSentence, type Recipe } from "./recipes";

interface Tick {
  readonly on: boolean;
  readonly amount: number | undefined;
}

export function BuilderSheet({
  starterId,
  recipe,
  onClose,
  onSend,
  onChangeHow,
  onTypeMyself,
}: {
  readonly starterId: string;
  readonly recipe: Recipe;
  readonly onClose: () => void;
  /** The child pressed Send on the sentence they read and changed. */
  readonly onSend: (text: string) => void;
  readonly onChangeHow: () => void;
  readonly onTypeMyself: () => void;
}) {
  const fieldId = useId();
  const [blanks, setBlanks] = useState<ReadonlyArray<string>>(() => recipe.blanks.map(() => ""));
  const [ticks, setTicks] = useState<Readonly<Record<string, Tick>>>(() =>
    Object.fromEntries(
      recipe.items.map((entry) => [entry.id, { on: false, amount: entry.stepper?.start }]),
    ),
  );
  const [screen, setScreen] = useState<"parts" | "edit">("parts");
  const [text, setText] = useState("");
  const [madeFrom, setMadeFrom] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (moved.current) {
      stage.current
        ?.closest<HTMLElement>('[role="dialog"]')
        ?.querySelector<HTMLElement>("[data-modal-title]")
        ?.focus();
    }
    moved.current = true;
  }, [screen]);

  const picked = recipe.items.filter((entry) => ticks[entry.id]?.on === true);
  const sentenceNow = () =>
    recipeSentence(
      starterId,
      blanks,
      picked.map((entry) => ({ id: entry.id, amount: ticks[entry.id]?.amount })),
    );
  const setTick = (id: string, patch: Partial<Tick>) =>
    setTicks((current) => ({ ...current, [id]: { ...current[id]!, ...patch } }));

  const header = <ChangeHowButton onClick={onChangeHow} />;
  const close = (
    <Button variant="quiet" onClick={onClose}>
      Close
    </Button>
  );

  if (screen === "edit") {
    return (
      <Sheet
        open
        wide
        onClose={onClose}
        title="Read it, change it"
        art={<SamArt />}
        initialFocus="title"
        headerAction={header}
        actions={close}
      >
        <div className="fm-builder" data-screen="edit">
          <div ref={stage} tabIndex={-1} className="fm-builder__stage">
            <label className="fm-builder__label" htmlFor={fieldId}>
              Your sentence
            </label>
            <textarea
              id={fieldId}
              className="fm-builder__text"
              rows={7}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <p className="fm-builder__note">
              The parts you picked are at the end. Change any words you like.
            </p>
            <div className="fm-picker__final-actions">
              <Button variant="plain" size="lg" icon={ArrowLeft} onClick={() => setScreen("parts")}>
                Back to the parts
              </Button>
              <Button
                variant="primary"
                size="lg"
                disabled={text.trim() === ""}
                onClick={() => onSend(text.trim())}
              >
                Send
              </Button>
            </div>
            <TypeMyselfLink onClick={onTypeMyself} />
          </div>
        </div>
      </Sheet>
    );
  }

  const writeItUp = () => {
    // Coming back without touching the parts keeps the words the child already changed.
    const fresh = sentenceNow();
    const key = JSON.stringify([
      blanks,
      picked.map((entry) => [entry.id, ticks[entry.id]?.amount]),
    ]);
    if (madeFrom !== key) {
      setText(fresh);
      setMadeFrom(key);
    }
    setScreen("edit");
  };

  return (
    <Sheet
      open
      wide
      onClose={onClose}
      title="Pick the parts"
      art={<SamArt />}
      initialFocus="title"
      headerAction={header}
      actions={close}
    >
      <div className="fm-builder" data-screen="parts">
        <div ref={stage} tabIndex={-1} className="fm-builder__stage">
          <div className="fm-builder__blanks">
            {recipe.blanks.map((blank, i) => (
              <label key={blank.label} className="fm-builder__blank">
                <span>{blank.label}</span>
                <input
                  type="text"
                  value={blanks[i] ?? ""}
                  maxLength={80}
                  autoComplete="off"
                  placeholder={`like ${exampleBlank(starterId, i)}`}
                  list={`${fieldId}-${i}`}
                  onChange={(event) =>
                    setBlanks((current) =>
                      current.map((entry, at) => (at === i ? event.target.value : entry)),
                    )
                  }
                />
                <datalist id={`${fieldId}-${i}`}>
                  {(choicesFor(starterId).find((set) => set.blankIndex === i)?.choices ?? []).map(
                    (choice) => (
                      <option key={choice.label} value={choice.label} />
                    ),
                  )}
                </datalist>
              </label>
            ))}
          </div>
          <h3 className="fm-words__question">Pick what goes in it</h3>
          <ul className="fm-builder__items">
            {recipe.items.map((entry) => {
              const tick = ticks[entry.id]!;
              return (
                <li key={entry.id} className="fm-builder__item" data-on={tick.on ? "" : undefined}>
                  <label className="fm-builder__check">
                    <input
                      type="checkbox"
                      checked={tick.on}
                      onChange={(event) => setTick(entry.id, { on: event.target.checked })}
                    />
                    <span className="fm-builder__art" aria-hidden>
                      {entry.art}
                    </span>
                    <span className="fm-builder__words">
                      <b>{entry.title}</b>
                      <small>{entry.hint}</small>
                    </span>
                  </label>
                  {entry.stepper !== undefined && tick.on ? (
                    <span
                      className="fm-builder__stepper"
                      role="group"
                      aria-label={`${entry.title} length`}
                    >
                      <button
                        type="button"
                        aria-label={`Shorter ${entry.title.toLowerCase()}`}
                        disabled={(tick.amount ?? entry.stepper.start) <= entry.stepper.min}
                        onClick={() =>
                          setTick(entry.id, {
                            amount: Math.max(
                              entry.stepper!.min,
                              (tick.amount ?? entry.stepper!.start) - entry.stepper!.step,
                            ),
                          })
                        }
                      >
                        <Minus size={16} aria-hidden />
                      </button>
                      <output aria-label={itemPhrase(entry, tick.amount)}>
                        {tick.amount}
                        {entry.stepper.unit}
                      </output>
                      <button
                        type="button"
                        aria-label={`Longer ${entry.title.toLowerCase()}`}
                        disabled={(tick.amount ?? entry.stepper.start) >= entry.stepper.max}
                        onClick={() =>
                          setTick(entry.id, {
                            amount: Math.min(
                              entry.stepper!.max,
                              (tick.amount ?? entry.stepper!.start) + entry.stepper!.step,
                            ),
                          })
                        }
                      >
                        <Plus size={16} aria-hidden />
                      </button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="fm-builder__bar">
            <span className="fm-builder__count" aria-live="polite">
              {picked.length} picked · you can add your own words next
            </span>
            <Button variant="primary" size="lg" onClick={writeItUp}>
              Write it up
            </Button>
          </div>
          <TypeMyselfLink onClick={onTypeMyself} />
        </div>
      </div>
    </Sheet>
  );
}
