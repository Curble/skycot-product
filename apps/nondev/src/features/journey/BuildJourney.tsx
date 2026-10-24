import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { useState } from "react";

import { estimateCopy, estimateBuildTime } from "../../plain/estimate";
import { readBuildTimes } from "../conversation/buildTimes";
import { ReadAloudButton } from "../voice/ReadAloud";
import { useFamily } from "../family/FamilyProvider";
import { useCrew } from "../../themes/useCrew";
import { chooseBuildWord, codePeekFor, explanationFor, wordFor } from "./library";
import { journeyFromItems, type JourneyStep } from "./steps";
import { readKnownWords, rememberWord } from "./words";
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

/** "About “What should happen when you win?”: Confetti!" (emoji dropped from the answer). */
export function tellSamText(question: string, label: string): string {
  const answer = label.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return `About “${question}”: ${answer}`;
}

function elapsedLabel(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes === 1 && remainder > 0 ? `1 min ${remainder} s` : `${minutes} min`;
}

export function BuildJourney({
  projection,
  elapsedMs,
  finished = false,
  onTellSam,
}: {
  readonly projection: OrchestrationV2ThreadProjection;
  readonly elapsedMs: number;
  readonly finished?: boolean;
  readonly onTellSam?: (text: string) => void;
}) {
  const family = useFamily();
  const child = family.profile.children.find((entry) => entry.id === family.profile.currentChildId);
  const level = child?.readingLevel ?? "makers";
  const childName = useCrew().builder.name;
  const journey = journeyFromItems(projection.turnItems, childName, finished);
  const [reviewStep, setReviewStep] = useState<JourneyStep | null>(null);
  const step = reviewStep ?? journey.now;
  const explanation = explanationFor(step, level, childName);
  const changedCode = projection.turnItems
    .flatMap((item) => (item.type === "file_change" ? [item.newStr ?? item.diffStr ?? ""] : []))
    .join("\n");
  const chosen = chooseBuildWord({
    fileNames: projection.turnItems.flatMap((item) =>
      item.type === "file_change" ? [item.fileName] : [],
    ),
    commands: projection.turnItems.flatMap((item) =>
      item.type === "command_execution" ? [item.input] : [],
    ),
    changedCode,
  });
  const word = wordFor(chosen, level);
  const [known, setKnown] = useState(() => (child ? readKnownWords(child.id) : []));
  const [answer, setAnswer] = useState<(typeof explanation.answers)[number] | null>(null);
  // While Sam is still thinking or planning, the plan's few seconds; then the build's minutes.
  const phase =
    journey.now === "Think it through" || journey.now === "Make a plan" ? "plan" : "build";
  const range = estimateBuildTime(readBuildTimes(), { kind: "other", model: "unknown", phase });
  const peek = level === "big-makers" ? codePeekFor(changedCode, chosen) : null;
  const textToRead = `${explanation.now} ${explanation.why}`;
  const steps = journey.steps.map((entry) => (
    <li key={entry.label} data-state={entry.state}>
      <button
        type="button"
        aria-current={entry.state === "now" && !reviewStep ? "step" : undefined}
        aria-label={`${entry.label}, ${entry.state}. Review this step`}
        onClick={() => {
          setReviewStep(entry.state === "now" ? null : entry.label);
          setAnswer(null);
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
            <small>Real lines from your project. Can you spot the {word.word}?</small>
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
        {answer ? (
          <>
            <p role="status">{answer.reply}</p>
            {answer.tellSam && onTellSam ? (
              <button
                className="fm-journey__tell"
                type="button"
                // The question travels with the answer, so the builder knows what it is about.
                onClick={() => onTellSam(tellSamText(explanation.question, answer.label))}
              >
                Tell {childName}
              </button>
            ) : null}
            <button type="button" className="fm-journey__again" onClick={() => setAnswer(null)}>
              Choose another answer
            </button>
          </>
        ) : (
          <>
            <p>{explanation.question}</p>
            <div className="fm-journey__answers">
              {explanation.answers.map((choice) => (
                <button type="button" key={choice.label} onClick={() => setAnswer(choice)}>
                  {choice.label}
                </button>
              ))}
            </div>
          </>
        )}
      </section>
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
    </section>
  );
}
