// The Explain card: the crew's "How I did it" lifted out of its last message (Sam explains,
// Mo double-checks), with an optional peek at the exact lines that changed. Shown under the
// message that carried the section; a message without one renders as before.
import type {
  EnvironmentId,
  OrchestrationV2ThreadProjection,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import type { Explanation } from "@t3tools/skycot-rules/explain";
import { Code2, Lightbulb } from "lucide-react";
import { useState } from "react";

import { useEnvironmentQuery } from "~/state/query";

import { orchestrationEnvironment } from "../../state/vcs";
import { CrewAvatar } from "../../themes/CrewAvatar";
import { useCrew } from "../../themes/useCrew";
import { Bubble } from "../../ui/Bubble";
import { Button } from "../../ui/Button";
import { Card, CardBody, CardHeader } from "../../ui/Card";
import { mayHaveChanges, rootCheckpoints, reviewTargetFor } from "../review/turnReview";
import { peekAtCode } from "./peek";
import { PeekAtCode } from "./PeekAtCode";
import { useChildView } from "../../app/useChildView";
import { kidSafeText } from "../conversation/kidSafeText";
import "./explain.css";

/** The anchor the What-changed card's "How did you do that?" button scrolls to. */
export const explainAnchor = (runId: string) => `[data-explain-run="${CSS.escape(runId)}"]`;

/** The checkpoint that closed this run with file changes, if any. */
function changedCheckpointFor(projection: OrchestrationV2ThreadProjection, runId: RunId | null) {
  if (runId === null) return null;
  return (
    rootCheckpoints(projection).findLast(
      (checkpoint) => checkpoint.runId === runId && mayHaveChanges(projection, checkpoint),
    ) ?? null
  );
}

export function ExplainCard({
  explanation,
  runId,
  streaming,
  projection,
  environmentId,
  threadId,
}: {
  readonly explanation: Explanation;
  readonly runId: RunId | null;
  readonly streaming: boolean;
  readonly projection: OrchestrationV2ThreadProjection;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const crew = useCrew();
  const childView = useChildView();
  const [peeking, setPeeking] = useState(false);
  const checkpoint = streaming ? null : changedCheckpointFor(projection, runId);
  const diffInput =
    peeking && checkpoint !== null
      ? (reviewTargetFor(projection, threadId, checkpoint.id)?.diffInput ?? null)
      : null;
  const diff = useEnvironmentQuery(
    diffInput === null
      ? null
      : orchestrationEnvironment.turnDiff({ environmentId, input: diffInput }),
  );

  return (
    <Bubble author="crew" full>
      <div className="fm-explain" data-explain-run={runId ?? undefined} tabIndex={-1}>
        <p className="fm-crew-kicker">
          {crew.named ? <CrewAvatar role="builder" size="sm" /> : null}
          {childView
            ? "Sam explains"
            : crew.named
              ? `${crew.builder.name} explains`
              : "How it was done"}
        </p>
        <Card label="How I did it">
          <CardHeader icon={Lightbulb} tone="blue" title="How I did it" />
          <CardBody>
            <p className="fm-explain__how">
              {childView ? kidSafeText(explanation.how) : explanation.how}
            </p>
            {explanation.check ? (
              <p className="fm-explain__check">
                {crew.named ? <CrewAvatar role="checker" size="sm" /> : null}
                <span>
                  <b>
                    {childView
                      ? "Sam checked this too:"
                      : crew.named
                        ? `${crew.checker.name} double-checked:`
                        : "Double-checked:"}
                  </b>{" "}
                  {childView ? kidSafeText(explanation.check) : explanation.check}
                </span>
              </p>
            ) : null}
            {checkpoint !== null ? (
              <div className="fm-explain__peek">
                <Button
                  size="sm"
                  icon={Code2}
                  aria-expanded={peeking}
                  onClick={() => setPeeking((open) => !open)}
                >
                  {peeking ? "Hide the code" : "Peek at the code"}
                </Button>
                {peeking ? (
                  diff.data ? (
                    <PeekAtCode peek={peekAtCode(diff.data.diff)} />
                  ) : diff.error ? (
                    <p className="fm-explain__note">The code couldn't be loaded just now.</p>
                  ) : (
                    <p className="fm-explain__note">Getting the code…</p>
                  )
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </Bubble>
  );
}
