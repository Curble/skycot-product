// What the two parties say: your blue bubbles, the Crew's grey bubbles with
// light Markdown, and the red-tinted "something went wrong" note.
// nondev-seam: skycot-iphone-q47-mac-rest-card
import type { EnvironmentId, OrchestrationV2TurnItem } from "@t3tools/contracts";
import { CircleAlert, MousePointerClick } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { describeTurnItem } from "../../../plain/narration";
import { isAssistantRefusal } from "../../family/assistantAllowance";
import { AssistantRefusalNote } from "./AssistantRefusalNote";
import { Mascot } from "../../brand/Mascot";
import { useCrew } from "../../../themes/useCrew";
import { Bubble, TypingIndicator } from "../../../ui/Bubble";
import { Card, CardBody, CardHeader } from "../../../ui/Card";
import { Disclosure } from "./Disclosure";
import { Markdown } from "./Markdown";
import { ReadAloudButton, useAutoReadAloud } from "../../voice/ReadAloud";
import type { TimelineRenderContext } from "./registry";
import { imagesOf, SentPictures } from "./SentPictures";
import { shortTime } from "./time";
import { useChildView } from "../../../app/useChildView";
import { childErrors } from "../../../plain/copy";
import { restCopy } from "../restCopy";
import { Button } from "../../../ui/Button";
import { Highlight } from "../../../ui/Highlight";
import { useState } from "react";
import { useDecisionDispatcher } from "./dispatch";
import { retryTextFor } from "./retryText";

type UserMessage = Extract<OrchestrationV2TurnItem, { type: "user_message" }>;
type AssistantMessage = Extract<OrchestrationV2TurnItem, { type: "assistant_message" }>;
type ErrorItem = Extract<OrchestrationV2TurnItem, { type: "error" }>;

const NO_POINTING: ReadonlyArray<string> = [];

export function UserBubble({
  item,
  environmentId,
  pointing = NO_POINTING,
  actions,
  onContextMenu,
}: {
  readonly item: UserMessage;
  /** Where the sent pictures are kept; without it they are only counted. */
  readonly environmentId?: EnvironmentId;
  /** What the person pointed at in the preview, lifted out of the message's words. */
  readonly pointing?: ReadonlyArray<string>;
  /** Shown after the time under the bubble (Edit, on your own messages). */
  readonly actions?: ReactNode;
  readonly onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const steered = item.inputIntent === "steer" || item.inputIntent === "promoted_queued_to_steer";
  const queued = item.inputIntent === "queued_turn";
  const pictures = environmentId === undefined ? [] : imagesOf(item.attachments);
  // Pictures show themselves; only what cannot be shown is counted.
  const others = item.attachments.length - pictures.length;
  const meta = [
    steered ? "Added while it worked" : queued ? "Lined up for later" : null,
    others > 0 ? `${others} ${others === 1 ? "picture" : "pictures"}` : null,
    shortTime(item.startedAt ?? item.updatedAt),
  ]
    .filter((part): part is string => !!part)
    .join(" · ");
  return (
    <Bubble
      author="me"
      meta={
        actions ? (
          <>
            {meta}
            {actions}
          </>
        ) : (
          meta || undefined
        )
      }
      onContextMenu={onContextMenu}
    >
      {pictures.length > 0 && environmentId !== undefined ? (
        <SentPictures environmentId={environmentId} pictures={pictures} />
      ) : null}
      <Highlight text={item.text} />
      {pointing.length > 0 ? (
        <span className="fm-bubble-pointing">
          {[...new Set(pointing)].map((label) => (
            <span key={label} className="fm-bubble-pointing__chip">
              <MousePointerClick size={12} strokeWidth={2} aria-hidden />
              Pointing at {label}
            </span>
          ))}
        </span>
      ) : null}
    </Bubble>
  );
}

export function CrewBubble({ item }: { readonly item: AssistantMessage }) {
  const crew = useCrew();
  useAutoReadAloud(item);
  if (item.text.trim().length === 0) return item.streaming ? <TypingIndicator /> : null;
  return (
    <Bubble
      author="crew"
      meta={
        item.streaming ? (
          `${crew.builder.name} is typing…`
        ) : (
          <>
            {shortTime(item.completedAt ?? item.updatedAt)}
            <ReadAloudButton id={item.id} text={item.text} />
          </>
        )
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
  // The Family profile refused an assistant nobody allowed: a grown-up card, not an error.
  if (isAssistantRefusal(item.failure.message)) {
    return <AssistantRefusalNote item={item} context={context} />;
  }
  return <FailureNote item={item} context={context} />;
}

function FailureNote({
  item,
  context,
}: {
  readonly item: ErrorItem;
  readonly context: TimelineRenderContext;
}) {
  const narration = describeTurnItem(item, {
    ...(context.projectName === null ? {} : { projectName: context.projectName }),
    usageLimitResetAt: context.shell?.runtime?.usageLimitResetAt ?? null,
  });
  const childView = useChildView();
  const childRest = childView && item.failure.class === "usage_limit";
  const retry = item.retry;
  // A real "Try again" for the child: it sends their last message again.
  const dispatch = useDecisionDispatcher({
    environmentId: context.environmentId,
    threadId: context.threadId,
    shell: context.shell,
  });
  const [trying, setTrying] = useState(false);
  const [retryProblem, setRetryProblem] = useState<string | null>(null);
  const retryText = childView && !childRest ? retryTextFor(context.items, context.index) : null;
  const tryAgain = async () => {
    if (retryText === null || trying) return;
    setTrying(true);
    setRetryProblem(null);
    const problem = await dispatch({ type: "send-message", text: retryText }, { text: retryText });
    setTrying(false);
    if (problem !== null) setRetryProblem(problem);
  };
  const retryLine =
    retry && retry.maxAttempts !== null
      ? `Trying again (attempt ${retry.attempt} of ${retry.maxAttempts}).`
      : retry
        ? `Trying again (attempt ${retry.attempt}).`
        : null;
  const restLines = childRest ? restCopy(item.failure.resetAt ?? null) : [];
  return (
    <Bubble author="crew" full meta={shortTime(item.updatedAt)}>
      {childRest ? null : (
        <p className="fm-mascot-kicker">
          <Mascot pose="oops" size={36} decorative />
          Oops
        </p>
      )}
      <div
        className={`fm-approval ${childRest ? "fm-approval--rest" : "fm-approval--high"}`}
        data-sober=""
      >
        <Card label={childRest ? "Sam needs a short rest" : "Something went wrong"}>
          <CardHeader
            icon={CircleAlert}
            tone={childRest ? "grey" : "red"}
            title={
              childView
                ? item.failure.class === "usage_limit"
                  ? "Sam needs a short rest"
                  : childErrors.gotStuck
                : narration.headline
            }
            subtitle={childView ? undefined : (retryLine ?? undefined)}
          />
          <CardBody>
            {childRest ? restLines.map((line) => <p key={line}>{line}</p>) : null}
            {!childView && narration.detail ? <p>{narration.detail}</p> : null}
            {!childView ? (
              <Disclosure>
                <pre className="fm-details__pre">
                  <code>{narration.technical}</code>
                </pre>
              </Disclosure>
            ) : null}
            {retryProblem !== null ? <p>{retryProblem}</p> : null}
            {retryText !== null ? (
              <Button variant="primary" onClick={() => void tryAgain()} disabled={trying}>
                Try again
              </Button>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </Bubble>
  );
}
