// "How did you do that?" under every What-changed card. When the crew already explained this
// turn, it brings that Explain card into view; otherwise it asks for an explanation in a
// follow-up message (explain mode on for that message whatever the switch says).
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  OrchestrationV2ThreadProjection,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { parseExplanation, withExplainMarker } from "@t3tools/skycot-rules/explain";
import { Lightbulb } from "lucide-react";
import { useState } from "react";

import { useDecisionDispatcher } from "../conversation/cards/dispatch";
import { useFamily } from "../family/FamilyProvider";
import { useCrew } from "../../themes/useCrew";
import { Button } from "../../ui/Button";
import { explainAnchor } from "./ExplainCard";
import "./explain.css";

export const ASK_FOR_EXPLANATION =
  "How did you do that? Explain the change you just made in simple words.";

/** True when an assistant message of this run carries a "How I did it" section. */
export function runHasExplanation(
  projection: OrchestrationV2ThreadProjection,
  runId: RunId | null,
): boolean {
  if (runId === null) return false;
  return projection.turnItems.some(
    (item) =>
      item.type === "assistant_message" &&
      item.runId === runId &&
      parseExplanation(item.text) !== null,
  );
}

export function ExplainAsk({
  runId,
  projection,
  environmentId,
  threadId,
  shell,
  active,
}: {
  readonly runId: RunId | null;
  readonly projection: OrchestrationV2ThreadProjection;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly shell: EnvironmentThreadShell | null;
  /** A run is in progress: a new question would have to wait, so the button rests. */
  readonly active: boolean;
}) {
  const crew = useCrew();
  const family = useFamily();
  const dispatch = useDecisionDispatcher({ environmentId, threadId, shell });
  const [state, setState] = useState<"idle" | "asking" | "asked">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const explained = runHasExplanation(projection, runId);

  const onClick = async () => {
    if (explained && runId !== null) {
      const card = document.querySelector<HTMLElement>(explainAnchor(runId));
      card?.scrollIntoView({ block: "center", behavior: "smooth" });
      card?.focus({ preventScroll: true });
      return;
    }
    setState("asking");
    setProblem(null);
    const failed = await dispatch(
      { type: "send-message", text: ASK_FOR_EXPLANATION },
      { text: withExplainMarker(ASK_FOR_EXPLANATION, true, family.enabled) },
    );
    setState(failed === null ? "asked" : "idle");
    setProblem(failed);
  };

  return (
    <div className="fm-explain-ask">
      <Button
        size="sm"
        icon={Lightbulb}
        disabled={state !== "idle" || (!explained && (active || shell === null))}
        onClick={() => void onClick()}
      >
        {state === "asking" ? "Asking…" : "How did you do that?"}
      </Button>
      {state === "asked" ? (
        <span className="fm-explain-ask__note">
          {crew.named ? `${crew.builder.name} is writing it up.` : "The explanation is on its way."}
        </span>
      ) : problem ? (
        <span className="fm-explain-ask__note">{problem}</span>
      ) : null}
    </div>
  );
}
