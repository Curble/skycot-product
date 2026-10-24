import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { useState } from "react";

import { estimateCopy, estimateBuildTime as estimateRange } from "../../plain/estimate";
import { readBuildTimes } from "../conversation/buildTimes";
import { ReadAloudButton } from "../voice/ReadAloud";
import { useFamily } from "../family/FamilyProvider";
import { useCrew } from "../../themes/useCrew";
import { chooseBuildWord, explanationFor, wordFor } from "./library";
import { journeyFromItems } from "./steps";
import { readKnownWords, rememberWord } from "./words";

export function BuildJourney({
  projection,
  elapsedMs,
}: {
  readonly projection: OrchestrationV2ThreadProjection;
  readonly elapsedMs: number;
}) {
  const family = useFamily();
  const child = family.profile.children.find((entry) => entry.id === family.profile.currentChildId);
  const level = child?.readingLevel ?? "makers";
  const childName = useCrew().builder.name;
  const journey = journeyFromItems(projection.turnItems, childName);
  const explanation = explanationFor(journey.now, level, childName);
  const chosen = chooseBuildWord({
    fileNames: projection.turnItems.flatMap((item) =>
      item.type === "file_change" ? [item.fileName] : [],
    ),
    commands: projection.turnItems.flatMap((item) =>
      item.type === "command_execution" ? [item.input] : [],
    ),
    changedCode: projection.turnItems
      .flatMap((item) => (item.type === "file_change" ? [item.newStr ?? item.diffStr ?? ""] : []))
      .join(" "),
  });
  const word = wordFor(chosen, level);
  const [known, setKnown] = useState(() => (child ? readKnownWords(child.id) : []));
  const range = estimateRange(readBuildTimes(), {
    kind: "other",
    model: "unknown",
    phase: "build",
  });
  const label = estimateCopy("build", range);
  const nowText = `${explanation.now} ${explanation.why} ${explanation.question}`;
  return (
    <section aria-label="Build Journey">
      <h2>Build Journey</h2>
      <p>
        {label} · {Math.floor(elapsedMs / 1000)} s so far
      </p>
      <ol>
        {journey.steps.map((step) => (
          <li key={step.label} aria-current={step.state === "now" ? "step" : undefined}>
            {step.label} · {step.state}
          </li>
        ))}
      </ol>
      {journey.facts.map((fact) => (
        <p key={fact}>{fact}</p>
      ))}
      <p>{explanation.now}</p>
      <p>{explanation.why}</p>
      <p>{explanation.question}</p>
      <ReadAloudButton id={`journey-${journey.now}`} text={nowText} />
      <p>
        Word of the build: <b>{word.word}</b> — {word.meaning}
      </p>
      {child && !known.includes(chosen) ? (
        <button type="button" onClick={() => setKnown(rememberWord(child.id, chosen))}>
          I know this word
        </button>
      ) : null}
      <p>
        Words I know: {known.length}
        {known.length >= 10 ? " · Word Wizard" : ""}
      </p>
      <ul>
        {explanation.answers.map((answer) => (
          <li key={answer.label}>
            {answer.label}: {answer.reply}
          </li>
        ))}
      </ul>
    </section>
  );
}
