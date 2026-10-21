import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  OrchestrationV2ThreadShell,
  OrchestrationV2TurnItem,
  ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { newMessageId } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";

import { canOperateEnvironmentAtom } from "../state/session";
import { environmentThreads, environmentThreadShells, threadEnvironment } from "../state/threads";

export function ThreadRoute({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const result = useAtomValue(environmentThreads.stateAtom(environmentId, threadId));
  const shell = useAtomValue(environmentThreadShells.environmentThreadIndexAtom(environmentId)).get(
    threadId,
  );
  const state = Option.getOrNull(AsyncResult.value(result));
  const projection = state ? Option.getOrNull(state.data) : null;

  return (
    <main className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 px-6 py-8 text-foreground">
      <header className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <a className="text-xs text-muted-foreground hover:underline" href="#/">
            Back to all threads
          </a>
          <h1 className="truncate text-lg font-semibold">
            {shell?.title || projection?.thread.title || "Thread"}
          </h1>
        </div>
        <span className="text-xs text-muted-foreground">
          {state ? state.status : "connecting"}
          {shell ? ` · ${shell.status}` : ""}
        </span>
      </header>

      {state && Option.isSome(state.error) ? (
        <Alert variant="error">
          <AlertDescription>{state.error.value}</AlertDescription>
        </Alert>
      ) : null}

      <ol className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-border/70 bg-card/60 p-4">
        {projection === null ? (
          <li className="text-sm text-muted-foreground">Loading the conversation...</li>
        ) : projection.turnItems.length === 0 ? (
          <li className="text-sm text-muted-foreground">Nothing has been said yet.</li>
        ) : (
          projection.turnItems.map((item) => <TimelineItem key={item.id} item={item} />)
        )}
      </ol>

      <Composer environmentId={environmentId} threadId={threadId} shell={shell} />
    </main>
  );
}

function TimelineItem({ item }: { readonly item: OrchestrationV2TurnItem }) {
  switch (item.type) {
    case "user_message":
      return <PlainRow label="You" text={item.text} />;
    case "assistant_message":
      return <PlainRow label={item.streaming ? "Agent (typing)" : "Agent"} text={item.text} />;
    case "reasoning":
      return <PlainRow label="Thinking" text={item.text} muted />;
    default:
      return (
        <PlainRow label={item.type.replace(/_/g, " ")} text={item.title ?? item.status} muted />
      );
  }
}

function PlainRow({
  label,
  text,
  muted = false,
}: {
  readonly label: string;
  readonly text: string;
  readonly muted?: boolean;
}) {
  return (
    <li className={`text-sm ${muted ? "text-muted-foreground" : "text-foreground"}`}>
      <span className="mr-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="whitespace-pre-wrap break-words">{text}</span>
    </li>
  );
}

function Composer({
  environmentId,
  threadId,
  shell,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly shell: OrchestrationV2ThreadShell | undefined;
}) {
  const canOperate = useAtomValue(canOperateEnvironmentAtom(environmentId));
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const disabled = !canOperate || shell === undefined || isSending;

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || shell === undefined) return;
    setIsSending(true);
    setErrorMessage("");
    const result = await startTurn({
      environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text: trimmed, attachments: [] },
        modelSelection: shell.modelSelection,
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
      },
    });
    setIsSending(false);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      setErrorMessage(failure instanceof Error ? failure.message : String(failure));
      return;
    }
    setText("");
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {!canOperate ? (
        <p className="text-xs text-muted-foreground">
          This session can read this thread but is not allowed to send messages.
        </p>
      ) : null}
      {errorMessage ? (
        <Alert variant="error">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex gap-2">
        <Input
          nativeInput
          className="flex-1"
          disabled={disabled}
          onChange={(event) => setText(event.currentTarget.value)}
          placeholder={canOperate ? "Tell the agent what to do next" : "Read-only session"}
          value={text}
        />
        <Button disabled={disabled || text.trim().length === 0} type="submit">
          {isSending ? "Sending..." : "Send"}
        </Button>
      </div>
    </form>
  );
}
