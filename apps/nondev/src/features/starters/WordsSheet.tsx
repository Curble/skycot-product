// The Words level of build help: two or three steps of word chips, with the sentence building
// live at the top as the child taps, an "Add a twist?" step, then "Make it!". Nothing is sent
// from here: Make it! hands the sentence over exactly as the Pictures picker does.
import { ArrowLeft, Dices, Keyboard } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { pickRandom, shownLabel } from "./choices";
import { ChangeHowButton, SamArt, TypeMyselfLink } from "./BuildHelpParts";
import {
  groupContent,
  groupKey,
  wordsSegments,
  wordsSentence,
  type Answers,
  type WordGroup,
  type WordsPlan,
} from "./wordChoices";

const TONES = ["orange", "green", "blue", "purple"] as const;

function Sentence({
  plan,
  answers,
  label,
}: {
  readonly plan: WordsPlan;
  readonly answers: Answers;
  readonly label: string;
}) {
  const keys = plan.steps.flatMap((step) => step.groups.map(groupKey));
  return (
    <div className="fm-words__sentence" aria-live="polite" aria-atomic="true">
      <span className="fm-words__sentence-label">{label}</span>
      <p>
        {wordsSegments(plan, answers, true).map((segment, i) =>
          segment.group === undefined ? (
            <span key={i}>{segment.text}</span>
          ) : (
            <mark
              key={i}
              className="fm-words__mark"
              data-tone={TONES[keys.indexOf(segment.group) % TONES.length]}
            >
              {segment.text}
            </mark>
          ),
        )}
      </p>
    </div>
  );
}

export function WordsSheet({
  starterId,
  plan,
  crewName,
  onClose,
  onMake,
  onChangeHow,
  onTypeMyself,
  random = Math.random,
}: {
  readonly starterId: string;
  readonly plan: WordsPlan;
  readonly crewName: string;
  readonly onClose: () => void;
  readonly onMake: (text: string) => void;
  readonly onChangeHow: () => void;
  readonly onTypeMyself: () => void;
  /** Injectable so the dice is testable; returns [0, 1). */
  readonly random?: () => number;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [index, setIndex] = useState(0);
  const [typing, setTyping] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  const final = index >= plan.steps.length;
  const step = plan.steps[index];

  // After the first move, put focus back at the top of the new screen: the sheet's title.
  useEffect(() => {
    if (moved.current) {
      stage.current
        ?.closest<HTMLElement>('[role="dialog"]')
        ?.querySelector<HTMLElement>("[data-modal-title]")
        ?.focus();
    }
    moved.current = true;
  }, [index]);

  const go = (to: number) => {
    setTyping(null);
    setDraft("");
    setIndex(to);
  };
  const set = (key: string, values: ReadonlyArray<string>) =>
    setAnswers((current) => ({ ...current, [key]: values }));

  const header = <ChangeHowButton onClick={onChangeHow} />;
  const close = (
    <Button variant="quiet" onClick={onClose}>
      Close
    </Button>
  );

  if (final) {
    return (
      <Sheet
        open
        wide
        onClose={onClose}
        title="Ready when you are"
        art={<SamArt />}
        initialFocus="title"
        headerAction={header}
        actions={close}
      >
        <div className="fm-words" data-screen="final">
          <div ref={stage} tabIndex={-1} className="fm-words__stage">
            <button
              type="button"
              className="fm-picker__back"
              aria-label="Back"
              onClick={() => go(plan.steps.length - 1)}
            >
              <ArrowLeft size={22} strokeWidth={2.2} aria-hidden />
              <span>Back</span>
            </button>
            <Dots total={plan.steps.length} index={index} />
            <Sentence plan={plan} answers={answers} label={`Here is what ${crewName} will make`} />
            <div className="fm-picker__final-actions">
              <Button
                variant="primary"
                size="lg"
                onClick={() => onMake(wordsSentence(plan, answers))}
              >
                Make it!
              </Button>
              <Button variant="plain" size="lg" onClick={() => go(0)}>
                Change my mind
              </Button>
            </div>
            <TypeMyselfLink onClick={onTypeMyself} />
          </div>
        </div>
      </Sheet>
    );
  }
  if (step === undefined) return null;

  const missing = step.groups.some(
    (group) => group.kind === "blank" && (answers[groupKey(group)] ?? []).length === 0,
  );
  const showQuestions = step.groups.length > 1 || step.twist === true;

  const toggleExtra = (group: Extract<WordGroup, { kind: "extra" }>, label: string) => {
    const key = groupKey(group);
    const now = answers[key] ?? [];
    if (now.includes(label))
      return set(
        key,
        now.filter((entry) => entry !== label),
      );
    const next = [...now, label];
    set(key, next.length > group.max ? next.slice(next.length - group.max) : next);
  };
  const finishTyping = (key: string) => {
    const words = draft.trim();
    setTyping(null);
    setDraft("");
    if (words !== "") set(key, [words]);
  };

  return (
    <Sheet
      open
      wide
      onClose={onClose}
      title={step.title}
      art={<SamArt />}
      initialFocus="title"
      headerAction={header}
      actions={close}
    >
      <div className="fm-words" data-screen="step">
        <div ref={stage} tabIndex={-1} className="fm-words__stage">
          {index > 0 ? (
            <button
              type="button"
              className="fm-picker__back"
              aria-label="Back"
              onClick={() => go(index - 1)}
            >
              <ArrowLeft size={22} strokeWidth={2.2} aria-hidden />
              <span>Back</span>
            </button>
          ) : null}
          <Dots total={plan.steps.length} index={index} />
          <Sentence plan={plan} answers={answers} label="Your idea so far" />
          {step.groups.map((group) => {
            const key = groupKey(group);
            const { question, chips } = groupContent(starterId, group);
            const picked = answers[key] ?? [];
            const typed =
              group.kind === "blank" &&
              picked[0] !== undefined &&
              !chips.some((chip) => chip.label === picked[0]);
            return (
              <section key={key} className="fm-words__group" aria-label={question}>
                {showQuestions ? (
                  <h3 className="fm-words__question">
                    {question}
                    {step.twist ? (
                      <small> · optional · pick one or two</small>
                    ) : group.kind === "extra" && group.max > 1 ? (
                      <small> · pick one or two</small>
                    ) : null}
                  </h3>
                ) : null}
                <ul className="fm-words__chips">
                  {chips.map((chip) => {
                    const on = picked.includes(chip.label);
                    return (
                      <li key={chip.label}>
                        <button
                          type="button"
                          className="fm-words__chip"
                          aria-label={shownLabel(chip.label)}
                          aria-pressed={on}
                          data-on={on ? "" : undefined}
                          onClick={() =>
                            group.kind === "extra"
                              ? toggleExtra(group, chip.label)
                              : set(key, on ? [] : [chip.label])
                          }
                        >
                          <span aria-hidden>{chip.art}</span>
                          <span>{shownLabel(chip.label)}</span>
                        </button>
                      </li>
                    );
                  })}
                  {group.kind === "blank" ? (
                    <>
                      {typed ? (
                        <li>
                          <button
                            type="button"
                            className="fm-words__chip"
                            aria-label={shownLabel(picked[0]!)}
                            aria-pressed
                            data-on=""
                            onClick={() => set(key, [])}
                          >
                            <span aria-hidden>✏️</span>
                            <span>{shownLabel(picked[0]!)}</span>
                          </button>
                        </li>
                      ) : null}
                      <li>
                        <button
                          type="button"
                          className="fm-words__chip fm-words__chip--special"
                          aria-label="Surprise me"
                          onClick={() => set(key, [pickRandom(chips, random).label])}
                        >
                          <Dices size={20} strokeWidth={1.9} aria-hidden />
                          <span>Surprise me</span>
                        </button>
                      </li>
                      <li>
                        <button
                          type="button"
                          className="fm-words__chip fm-words__chip--special"
                          aria-label="Type it"
                          aria-expanded={typing === key}
                          onClick={() => {
                            setTyping(key);
                            setDraft(typed ? picked[0]! : "");
                          }}
                        >
                          <Keyboard size={20} strokeWidth={1.9} aria-hidden />
                          <span>Type it</span>
                        </button>
                      </li>
                    </>
                  ) : null}
                  {step.twist ? (
                    <li>
                      <button
                        type="button"
                        className="fm-words__chip fm-words__chip--special"
                        aria-label="No twist, thanks"
                        aria-pressed={picked.length === 0}
                        onClick={() => {
                          set(key, []);
                          go(index + 1);
                        }}
                      >
                        <span>No twist, thanks</span>
                      </button>
                    </li>
                  ) : null}
                </ul>
                {typing === key ? (
                  <form
                    className="fm-picker__type"
                    onSubmit={(event) => {
                      event.preventDefault();
                      finishTyping(key);
                    }}
                  >
                    <label className="fm-picker__type-label" htmlFor="fm-words-type">
                      Type your own answer
                    </label>
                    <div className="fm-picker__type-row">
                      <input
                        id="fm-words-type"
                        className="fm-picker__input"
                        type="text"
                        value={draft}
                        maxLength={80}
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
              </section>
            );
          })}
          <div className="fm-picker__next">
            <Button
              variant="primary"
              size="lg"
              disabled={missing || typing !== null}
              onClick={() => go(index + 1)}
            >
              Next
            </Button>
          </div>
          <TypeMyselfLink onClick={onTypeMyself} />
        </div>
      </div>
    </Sheet>
  );
}

function Dots({ total, index }: { readonly total: number; readonly index: number }) {
  return (
    <div
      className="fm-picker__dots"
      role="img"
      aria-label={`Step ${Math.min(index + 1, total)} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <i key={i} data-state={i < index ? "done" : i === index ? "now" : "next"} />
      ))}
    </div>
  );
}
