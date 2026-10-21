// What the two parties say: your blue bubbles, the Crew's grey bubbles with
// light Markdown, and the red-tinted "something went wrong" note.
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { CircleAlert } from "lucide-react";

import { CREW_NAME } from "../../../brand";
import { describeTurnItem } from "../../../plain/narration";
import { Bubble, TypingIndicator } from "../../../ui/Bubble";
import { Card, CardBody, CardHeader } from "../../../ui/Card";
import { Disclosure } from "./Disclosure";
import { Markdown } from "./Markdown";
import type { TimelineRenderContext } from "./registry";
import { shortTime } from "./time";

type UserMessage = Extract<OrchestrationV2TurnItem, { type: "user_message" }>;
type AssistantMessage = Extract<OrchestrationV2TurnItem, { type: "assistant_message" }>;
type ErrorItem = Extract<OrchestrationV2TurnItem, { type: "error" }>;

export function UserBubble({ item }: { readonly item: UserMessage }) {
  const steered = item.inputIntent === "steer" || item.inputIntent === "promoted_queued_to_steer";
  const queued = item.inputIntent === "queued_turn";
  const attachments = item.attachments.length;
  const meta = [
    steered ? "Added while it worked" : queued ? "Lined up for later" : null,
    attachments > 0 ? `${attachments} ${attachments === 1 ? "picture" : "pictures"}` : null,
    shortTime(item.startedAt ?? item.updatedAt),
  ]
    .filter((part): part is string => !!part)
    .join(" · ");
  return (
    <Bubble author="me" meta={meta || undefined}>
      {item.text}
    </Bubble>
  );
}

export function CrewBubble({ item }: { readonly item: AssistantMessage }) {
  if (item.text.trim().length === 0) return item.streaming ? <TypingIndicator /> : null;
  return (
    <Bubble
      author="crew"
      meta={
        item.streaming ? `${CREW_NAME} is typing…` : shortTime(item.completedAt ?? item.updatedAt)
      }
    >
      <Markdown text={item.text} />
    </Bubble>
  );
}

export function ErrorNote({
  item,
  context,
}: {
  readonly item: ErrorItem;
  readonly context: TimelineRenderContext;
}) {
  const narration = describeTurnItem(
    item,
    context.projectName === null ? {} : { projectName: context.projectName },
  );
  const retry = item.retry;
  const retryLine =
    retry && retry.maxAttempts !== null
      ? `Trying again (attempt ${retry.attempt} of ${retry.maxAttempts}).`
      : retry
        ? `Trying again (attempt ${retry.attempt}).`
        : null;
  return (
    <Bubble author="crew" full meta={shortTime(item.updatedAt)}>
      <div className="fm-approval fm-approval--high">
        <Card label="Something went wrong">
          <CardHeader
            icon={CircleAlert}
            tone="red"
            title={narration.headline}
            subtitle={retryLine ?? undefined}
          />
          <CardBody>
            {narration.detail ? <p>{narration.detail}</p> : null}
            <Disclosure>
              <pre className="fm-details__pre">
                <code>{narration.technical}</code>
              </pre>
            </Disclosure>
          </CardBody>
        </Card>
      </div>
    </Bubble>
  );
}
