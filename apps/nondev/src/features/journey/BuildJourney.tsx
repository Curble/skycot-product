import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { elapsedWords, estimateCopy } from "../../plain/estimate";
import { estimateForRun } from "../conversation/runEstimate";
import { ReadAloudButton } from "../voice/ReadAloud";
import { useFamily } from "../family/FamilyProvider";
import { useCrew } from "../../themes/useCrew";
import { chooseBuildWord, codePeekFor, explanationFor, journeyIsGame, wordFor } from "./library";
import { journeyFromItems, type JourneyStep } from "./steps";
import { readBuildWord, readKnownWords, rememberBuildWord, rememberWord } from "./words";
import "./journey.css";

const STEP_PICTURES: Record<JourneyStep, string> = {
  "Think it through": "💭",
  "Make a plan": "📝",
  "Build it": "🔨",
  "Test it": "🧪",
  Finish: "🎉",
};

function lookBackFor(step: JourneyStep, facts: ReadonlyArray<string>): string {
  const detail =
    step === "Make a plan"
      ? facts.find((fact) => fact.includes("steps"))
      : step === "Build it"
        ? facts.find((fact) => fact.includes("wrote"))
        : step === "Test it"
          ? facts.find((fact) => fact.includes("checked"))
          : undefined;
  if (detail) return detail;
  if (step === "Think it through") return "Sam read your idea and thought about what to make.";
  if (step === "Finish") return "Sam finished and saved your work.";
  return "Sam worked through this step.";
}

export function elapsedLabel(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const remainder = seconds % 60;
  return seconds >= 60 && seconds < 120 && remainder > 0
    ? `1 minute ${remainder} ${remainder === 1 ? "second" : "seconds"}`
    : elapsedWords(milliseconds);
}

export function BuildJourney({
  projection,
  elapsedMs,
  finished = false,
  runId,
  onTellSam,
}: {
  readonly projection: OrchestrationV2ThreadProjection;
  readonly elapsedMs: number;
  readonly finished?: boolean;
  readonly runId?: string | null;
  readonly onTellSam?: (text: string) => void;
}) {
  const family = useFamily();
  const child = family.profile.children.find((entry) => entry.id === family.profile.currentChildId);
  const level = child?.readingLevel ?? "makers";
  const childName = useCrew().builder.name;
  const latestRunId =
    runId ?? projection.turnItems.findLast((item) => item.runId !== null)?.runId ?? null;
  const journey = journeyFromItems(projection.turnItems, childName, finished, latestRunId);
  const [reviewStep, setReviewStep] = useState<JourneyStep | null>(null);
  const step = reviewStep ?? journey.now;
  const request = projection.turnItems.find((item) => item.type === "user_message");
  const game = journeyIsGame(request?.type === "user_message" ? request.text : "");
  const explanation = explanationFor(step, level, childName, game);
  const currentItems = projection.turnItems.filter((item) => item.runId === latestRunId);
  const changedCode = currentItems
    .flatMap((item) => (item.type === "file_change" ? [item.newStr ?? item.diffStr ?? ""] : []))
    .join("\n");
  const candidate = chooseBuildWord({
    fileNames: currentItems.flatMap((item) => (item.type === "file_change" ? [item.fileName] : [])),
    commands: currentItems.flatMap((item) =>
      item.type === "command_execution" ? [item.input] : [],
    ),
    changedCode,
  });
  const [chosen, setChosen] = useState<typeof candidate | null>(() => readBuildWord(latestRunId));
  if (chosen === null && (candidate !== "plan" || finished)) setChosen(candidate);
  useEffect(() => {
    if (latestRunId !== null && chosen !== null) rememberBuildWord(latestRunId, chosen);
  }, [latestRunId, chosen]);
  const word = chosen === null ? null : wordFor(chosen, level);
  const [known, setKnown] = useState(() => (child ? readKnownWords(child.id) : []));
  // The question belongs to the child until they answer, even if the build finishes first.
  const [questionStep, setQuestionStep] = useState(journey.now);
  const [answer, setAnswer] = useState<(typeof explanation.answers)[number] | null>(null);
  const [lastStep, setLastStep] = useState(journey.now);
  if (lastStep !== journey.now) {
    setLastStep(journey.now);
    if (answer !== null) {
      setAnswer(null);
      setQuestionStep(journey.now);
    }
  }
  const thinking = explanationFor(questionStep, level, childName, game);
  const { phase, range } = estimateForRun(projection.runs?.find((run) => run.id === latestRunId));
  const peek = level === "big-makers" && chosen !== null ? codePeekFor(changedCode, chosen) : null;
  const textToRead = `${explanation.now} ${explanation.why}`;
  const steps = journey.steps.map((entry) => (
    <li key={entry.label} data-state={entry.state}>
      <button
        type="button"
        aria-current={entry.state === "now" && !reviewStep ? "step" : undefined}
        aria-label={`${entry.label}, ${entry.state}. Review this step`}
        onClick={() => {
          setReviewStep(entry.state === "now" ? null : entry.label);
        }}
      >
        <span className="fm-journey__step-mark" aria-hidden>
          {STEP_PICTURES[entry.label]}
        </span>
        <span>{entry.label}</span>
        <small>{entry.state === "done" ? "✓ done" : entry.state}</small>
      </button>
    </li>
  ));
  return (
    <section className="fm-journey" aria-label="Build Journey">
      <header className="fm-journey__header">
        <span className="fm-journey__eyebrow">{childName.toUpperCase()}'S NOTEBOOK</span>
        <h2>Build Journey</h2>
      </header>
      <nav className="fm-journey__tabs" aria-label="Build steps">
        <ol>{steps}</ol>
      </nav>
      <p className="fm-journey__track-note">Tap a finished step to look back at what happened.</p>
      <div className="fm-journey__time" aria-label="Build time">
        <span aria-hidden>☁️</span>
        <span className="fm-journey__footprints" aria-hidden>
          · · · · · ·
        </span>
        <span aria-hidden>🏁</span>
        <p>
          {estimateCopy(phase, range).replace(/\.$/u, "")}
          {!finished ? ` · ${elapsedLabel(elapsedMs)} so far` : " · All done!"}
        </p>
      </div>
      <article className="fm-journey__hero">
        <h3>What {childName} is doing right now</h3>
        <p>{explanation.now}</p>
        {level === "little-makers" ? (
          <div className="fm-journey__picture" aria-hidden>
            {STEP_PICTURES[step]}
          </div>
        ) : null}
        {peek !== null && (step === "Build it" || step === "Test it" || step === "Finish") ? (
          <div className="fm-journey__code" aria-label="Code from your project">
            <code>
              {peek.map((line, index) => (
                <span key={index}>
                  {line}
                  <br />
                </span>
              ))}
            </code>
            <small>Real lines from your project. Can you spot the {word?.word}?</small>
          </div>
        ) : null}
        <ReadAloudButton id={`journey-${step}`} text={textToRead} />
      </article>
      <section className="fm-journey__why">
        <h3>Why makers do this step</h3>
        <p>{explanation.why}</p>
        {reviewStep ? (
          <p className="fm-journey__fact">{lookBackFor(reviewStep, journey.facts)}</p>
        ) : null}
      </section>
      <section className="fm-journey__think">
        <h3>Your turn to think</h3>
        <small className="fm-journey__optional">Just for fun — nothing to answer here.</small>
        {answer ? (
          <>
            <p role="status">{answer.reply}</p>
            {answer.tellSam && onTellSam ? (
              <button
                className="fm-journey__tell"
                type="button"
                onClick={() => onTellSam(answer.say)}
              >
                Tell {childName}
              </button>
            ) : null}
            <button
              type="button"
              className="fm-journey__again"
              onClick={() => {
                setAnswer(null);
                setQuestionStep(journey.now);
              }}
            >
              {questionStep === journey.now ? "Choose another answer" : "Next question"}
            </button>
          </>
        ) : (
          <>
            <p>{thinking.question}</p>
            <div className="fm-journey__answers">
              {thinking.answers.map((choice) => (
                <button type="button" key={choice.label} onClick={() => setAnswer(choice)}>
                  {choice.label}
                </button>
              ))}
            </div>
          </>
        )}
      </section>
      {word !== null && chosen !== null ? (
        <section className="fm-journey__word">
          <div>
            <span className="fm-journey__eyebrow">WORD OF THE BUILD</span>
            <h3>{word.word}</h3>
            <p>{word.meaning}</p>
            {child && !known.includes(chosen) ? (
              <button
                type="button"
                className="fm-journey__know"
                onClick={() => setKnown(rememberWord(child.id, chosen))}
              >
                I know this word
              </button>
            ) : null}
          </div>
          <aside className="fm-journey__pocket" aria-label="Words I know">
            <b>Words I know</b>
            <span>{known.length} words collected</span>
            <div
              className="fm-journey__dots"
              aria-label={`${Math.min(known.length, 10)} of 10 words`}
            >
              {Array.from({ length: 10 }, (_, index) => (
                <i key={index} data-filled={index < known.length || undefined} />
              ))}
            </div>
            <small>
              {known.length >= 10
                ? "Word Wizard sticker earned!"
                : `${10 - known.length} more for the Word Wizard sticker`}
            </small>
          </aside>
        </section>
      ) : null}
    </section>
  );
}
