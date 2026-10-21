// "Here's my plan": the proposed_plan item as an Apple link-preview card with
// numbered steps and three chips. "Looks good" starts the real work from the
// plan (the same `sourceProposedPlan` the stock UI sends); the other two open a
// reply field inside the card so the conversation stays in the stream.
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { ListChecks } from "lucide-react";
import { useState } from "react";

import { describeRuntimeRequest } from "../../../plain/approvals";
import { Banner } from "../../../ui/Banner";
import { Bubble } from "../../../ui/Bubble";
import { Button } from "../../../ui/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../../ui/Card";
import { useDecisionDispatcher } from "./dispatch";
import { InlineReply } from "./InlineReply";
import { Markdown, parseMarkdown } from "./Markdown";
import type { TimelineRenderContext } from "./registry";
import { shortTime } from "./time";

type PlanItem = Extract<OrchestrationV2TurnItem, { type: "proposed_plan" }>;

type Mode = "idle" | "change" | "ask";

function countSteps(markdown: string): number {
  return parseMarkdown(markdown)
    .filter((block) => block.kind === "ol")
    .reduce((sum, block) => sum + (block.kind === "ol" ? block.items.length : 0), 0);
}

export function PlanCard({
  item,
  context,
}: {
  readonly item: PlanItem;
  readonly context: TimelineRenderContext;
}) {
  const { projection, environmentId, threadId, shell, projectName } = context;
  const plan = projection.plans.find((p) => p.id === item.planId);
  const acceptedRun = projection.runs.find((run) => run.sourcePlanRef?.planId === item.planId);
  const busyThread = shell ? threadRuntimeIsActive(shell.runtime) : false;
  const card = describeRuntimeRequest(item, projectName === null ? {} : { projectName });
  const dispatch = useDecisionDispatcher({ environmentId, threadId, shell });
  const [mode, setMode] = useState<Mode>("idle");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const state = item.streaming
    ? "writing"
    : acceptedRun
      ? "accepted"
      : plan?.status === "superseded"
        ? "superseded"
        : plan?.status === "completed"
          ? "completed"
          : busyThread
            ? "busy"
            : "actionable";

  const steps = countSteps(item.markdown);
  const subtitle =
    state === "writing"
      ? "Writing the plan…"
      : state === "accepted"
        ? `You said go · ${shortTime(acceptedRun?.requestedAt ?? null)}`
        : state === "superseded"
          ? "Replaced by a newer plan"
          : state === "completed"
            ? "Carried out"
            : `${steps > 0 ? `${steps} ${steps === 1 ? "step" : "steps"} · ` : ""}${card.whyItMatters}`;

  const approve = card.options.find((o) => o.id === "approve");

  const run = async (text: string, approving: boolean) => {
    setSending(true);
    setProblem(null);
    const result = await dispatch(
      { type: "send-message", text },
      {
        text,
        ...(approving ? { plan: { planId: item.planId, interactionMode: "default" } } : {}),
      },
    );
    setSending(false);
    if (result !== null) {
      setProblem(result);
      return;
    }
    setMode("idle");
  };

  return (
    <Bubble author="crew" full meta={shortTime(item.completedAt ?? item.updatedAt)}>
      <Card label="Plan">
        <CardHeader icon={ListChecks} tone="blue" title="Here's my plan" subtitle={subtitle} />
        <CardBody>
          <Markdown text={item.markdown} className="fm-md--plan" />
          {state === "actionable" ? <p className="fm-plan__note">{card.ifYouSayNo}</p> : null}
        </CardBody>
        {state === "actionable" && approve ? (
          <CardFooter>
            {mode === "idle" ? (
              <div className="fm-chips">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={sending}
                  onClick={() =>
                    void run(
                      approve.decision.type === "send-message"
                        ? approve.decision.text
                        : "Looks good — go ahead with the plan.",
                      true,
                    )
                  }
                >
                  {sending ? "Starting…" : "Looks good, go"}
                </Button>
                <Button size="sm" disabled={sending} onClick={() => setMode("change")}>
                  Change the plan
                </Button>
                <Button size="sm" variant="quiet" disabled={sending} onClick={() => setMode("ask")}>
                  Ask me something first
                </Button>
              </div>
            ) : (
              <div className="fm-plan__reply">
                <InlineReply
                  label={mode === "change" ? "What should change in the plan" : "Your question"}
                  placeholder={
                    mode === "change"
                      ? "What should be different? (“skip step 3”, “use placeholders”)"
                      : "What do you want to know before deciding?"
                  }
                  busy={sending}
                  onSend={(text) => void run(text, false)}
                  onCancel={() => setMode("idle")}
                />
                <Button
                  size="sm"
                  variant="plain"
                  disabled={sending}
                  onClick={() => setMode("idle")}
                >
                  Cancel
                </Button>
              </div>
            )}
            {problem ? (
              <div className="fm-card__problem">
                <Banner tone="warning">{problem}</Banner>
              </div>
            ) : null}
          </CardFooter>
        ) : null}
      </Card>
    </Bubble>
  );
}
