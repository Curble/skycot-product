import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScheduledTask } from "@t3tools/contracts";
import { Bell, KeyRound, Play, Trash2 } from "lucide-react";
import { useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import { serverEnvironment } from "../../state/server";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { List, ListExtra, ListRow } from "../../ui/ListRow";
import { Sheet } from "../../ui/Sheet";
import { CopyButton } from "../settings/CopyButton";
import { describeRelative, describeSchedule } from "./schedule";

export function AutomationDetailSheet({
  environmentId,
  task,
  projectTitle,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
  readonly projectTitle: string;
  readonly onClose: () => void;
}) {
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, { reportFailure: false });
  const remove = useAtomCommand(serverEnvironment.deleteScheduledTask, { reportFailure: false });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ran, setRan] = useState(false);

  const act = async (request: () => Promise<{ _tag: string }>, after?: () => void) => {
    setBusy(true);
    setProblem(null);
    const outcome = await request();
    setBusy(false);
    if (outcome._tag === "Failure") {
      const cause = squashAtomCommandFailure(outcome as never);
      setProblem(cause instanceof Error ? cause.message.split("\n")[0]! : "That didn't work.");
      return;
    }
    after?.();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      icon={Bell}
      title={task.title}
      description={`${describeSchedule(task.schedule)} · ${projectTitle}`}
      wide
      actions={
        <>
          {confirmRemove ? (
            <>
              <Button onClick={() => setConfirmRemove(false)} disabled={busy}>
                Keep it
              </Button>
              <Button
                variant="destructive"
                filled
                icon={Trash2}
                disabled={busy}
                onClick={() =>
                  void act(() => remove({ environmentId, input: { id: task.id } }), onClose)
                }
              >
                Remove automation
              </Button>
            </>
          ) : (
            <>
              <Button variant="destructive" icon={Trash2} onClick={() => setConfirmRemove(true)}>
                Remove…
              </Button>
              <Button
                icon={Play}
                disabled={busy || !task.enabled}
                onClick={() =>
                  void act(
                    () => runNow({ environmentId, input: { id: task.id } }),
                    () => setRan(true),
                  )
                }
              >
                {ran ? "Started" : "Run now"}
              </Button>
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </>
          )}
        </>
      }
      note={
        confirmRemove
          ? "Removing stops future runs. Conversations it already started stay in your list."
          : !task.enabled
            ? "This automation is paused. Switch it on from the list to run it."
            : undefined
      }
    >
      <List label="Details">
        <ListRow
          title="What it does"
          subtitle={<span className="fm-prewrap">{task.prompt}</span>}
        />
        <ListRow
          title="Last run"
          subtitle={
            task.lastRunAt
              ? `${describeRelative(task.lastRunAt)} · ${
                  task.lastRunStatus === "succeeded"
                    ? "finished"
                    : task.lastRunStatus === "failed"
                      ? `didn't finish${task.lastRunError ? `: ${task.lastRunError.split("\n")[0]}` : ""}`
                      : task.lastRunStatus === "running"
                        ? "running now"
                        : ""
                }`
              : "Hasn't run yet"
          }
        />
        <ListRow
          title="Next run"
          subtitle={
            task.enabled && task.nextRunAt ? describeRelative(task.nextRunAt) : "Not scheduled"
          }
        />
        <ListRow
          title="Where results go"
          subtitle={
            task.threadId ? "The same conversation each time" : "A new conversation each run"
          }
        />
        <ListRow
          title="Autonomy"
          subtitle="Ask me first — every run waits for your OK before changing anything."
        />
        {task.webhook ? (
          <>
            <ListRow
              leading={<KeyRound size={16} strokeWidth={1.7} aria-hidden />}
              title="Trigger address"
              subtitle={
                task.webhook.url ? (
                  <code className="fm-code fm-code--wrap">{task.webhook.url}</code>
                ) : (
                  "Available once this Mac is reachable from the internet."
                )
              }
              trailing={
                task.webhook.url ? <CopyButton text={task.webhook.url} label="Copy" /> : null
              }
            />
            <ListExtra>
              <div className="fm-sheet-inset">
                <Banner tone="warning">
                  This address is a key. Anyone who has it can start this automation. Share it only
                  with the app that should trigger it.
                </Banner>
              </div>
            </ListExtra>
          </>
        ) : null}
      </List>
      {problem ? (
        <div className="fm-sheet-inset">
          <Banner tone="danger">{problem}</Banner>
        </div>
      ) : null}
    </Sheet>
  );
}
