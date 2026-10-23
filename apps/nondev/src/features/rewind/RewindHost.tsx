import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import { threadEnvironment } from "../../state/threads";
import { useCrew } from "../../themes/useCrew";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { useTidy } from "../tidy/useTidy";
import { copy, editableText } from "./rewind";
import { clearEditRequest, startEditing, useEditRequest } from "./store";
import type { useRewindFacts } from "./useGoBack";

/**
 * Turns a press of Edit into either the message back in the reply box, or a sheet that says
 * plainly why not yet. "Sam is still working" offers Stop and "put away" offers Bring back;
 * once either has happened the message goes into the box by itself.
 */
export function RewindHost({
  environmentId,
  threadId,
  shell,
  facts,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly shell: EnvironmentThreadShell | null;
  readonly facts: ReturnType<typeof useRewindFacts>;
}) {
  const request = useEditRequest(threadId);
  const crew = useCrew();
  const tidy = useTidy();
  const interrupt = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const [busy, setBusy] = useState(false);

  // Checked on every render while a press is waiting: Stop landing, or Bring back, lets it
  // through without pressing Edit again.
  const result = request === null ? null : facts.check(request.itemId);
  const block = result !== null && !result.ok ? result.block : null;
  const item = result?.ok === true && request !== null ? facts.findItem(request.itemId) : null;
  const words = item === null ? null : editableText(item.text);
  const ready =
    item === null || words === null || item.runId === null
      ? null
      : {
          itemId: item.id,
          runId: item.runId,
          text: words.text,
          pictures: item.attachments.length,
          pointedAt: words.pointedAt,
        };
  const readyKey = ready === null ? null : `${request?.nonce}:${ready.itemId}`;
  const readyRef = useRef(ready);
  useEffect(() => {
    readyRef.current = ready;
  });
  useEffect(() => {
    const draft = readyRef.current;
    if (readyKey === null || draft === null) return;
    startEditing(threadId, draft);
    clearEditRequest(threadId);
  }, [readyKey, threadId]);

  const close = () => clearEditRequest(threadId);

  if (block === null) return null;
  const said = copy.blocked(block, crew.builder.name);
  const action =
    block === "working" && shell !== null ? (
      <Button
        variant="destructive"
        filled
        icon={Square}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const runId = shell.runtime?.activeRunId ?? null;
          await interrupt({ environmentId, input: { threadId, ...(runId ? { runId } : {}) } });
          setBusy(false);
        }}
      >
        {busy ? "Stopping…" : "Stop"}
      </Button>
    ) : block === "put-away" && shell !== null ? (
      <Button
        variant="primary"
        filled
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await tidy.bringBack(shell, { toast: false });
          setBusy(false);
        }}
      >
        {busy ? "Bringing back…" : "Bring back"}
      </Button>
    ) : null;

  return (
    <Sheet
      open
      onClose={close}
      title={said.title}
      description={said.body}
      icon={RotateCcw}
      iconTone="grey"
      actions={
        <>
          <Button onClick={close}>{action ? "Cancel" : "OK"}</Button>
          {action}
        </>
      }
    />
  );
}
