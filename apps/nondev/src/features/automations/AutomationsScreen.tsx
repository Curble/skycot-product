import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ScheduledTask, ScheduledTaskListResult } from "@t3tools/contracts";
import { Atom, AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { Bell, ChevronRight, Plus, Webhook } from "lucide-react";
import { useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import { enabledEnvironmentIdsAtom } from "../../state/catalog";
import { environmentProjects } from "../../state/projects";
import { serverEnvironment } from "../../state/server";
import { Button, IconButton } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { List, ListRow } from "../../ui/ListRow";
import { StepBadge } from "../../ui/StepBadge";
import { Switch } from "../../ui/Switch";
import { AutomationDetailSheet } from "./AutomationDetailSheet";
import { NewAutomationSheet } from "./NewAutomationSheet";
import { describeRelative, describeSchedule } from "./schedule";

const EMPTY_TASKS_ATOM = Atom.make<AsyncResult.AsyncResult<ScheduledTaskListResult, unknown>>(
  AsyncResult.initial(),
).pipe(Atom.withLabel("nondev-scheduled-tasks:empty"));

/** Scheduled jobs in plain words: what, when, where, with an on/off switch. */
export function AutomationsScreen() {
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const environmentId: EnvironmentId | null = environmentIds[0] ?? null;
  const live = useAtomValue(
    environmentId === null
      ? EMPTY_TASKS_ATOM
      : serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const setEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    reportFailure: false,
  });
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<ScheduledTask["id"] | null>(null);

  const tasks = Option.getOrNull(AsyncResult.value(live))?.tasks ?? null;
  const failed = live._tag === "Failure";
  const projectTitle = (task: ScheduledTask) =>
    projects.find(
      (project) => project.environmentId === environmentId && project.id === task.projectId,
    )?.title ?? "a project";
  const selectedTask = tasks?.find((task) => task.id === selected) ?? null;

  return (
    <div className="fm-home">
      <div className="fm-home__inner">
        <div className="fm-screen-head">
          <div>
            <h2 className="fm-home__greeting">Automations</h2>
            <p className="fm-home__sub">
              Jobs that run on their own, on a schedule you choose. Results wait for your OK.
            </p>
          </div>
          {environmentId ? (
            <Button variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>
              New automation
            </Button>
          ) : null}
        </div>

        {environmentId === null || tasks === null ? (
          <EmptyState icon={Bell} title={failed ? "Couldn't load your automations" : "Loading…"}>
            {failed ? "Your Mac didn't answer. Try again in a moment." : undefined}
          </EmptyState>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No automations yet"
            action={
              <Button variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>
                New automation
              </Button>
            }
          >
            A Monday booking summary, a nightly check that the site still loads, a weekly tidy-up —
            anything you'd otherwise have to remember to ask.
          </EmptyState>
        ) : (
          <List label="Automations">
            {tasks.map((task) => (
              <ListRow
                key={task.id}
                leading={
                  <StepBadge
                    state={task.lastRunStatus === "failed" ? "warn" : task.enabled ? "ok" : "todo"}
                    icon={task.schedule.type === "webhook" ? Webhook : Bell}
                  />
                }
                title={task.title}
                subtitle={
                  <>
                    {describeSchedule(task.schedule)} · {projectTitle(task)}
                    {task.lastRunAt
                      ? ` · last ran ${describeRelative(task.lastRunAt)}${task.lastRunStatus === "failed" ? " (didn't finish)" : ""}`
                      : " · hasn't run yet"}
                    {task.enabled && task.nextRunAt
                      ? ` · next ${describeRelative(task.nextRunAt)}`
                      : ""}
                    {!task.enabled ? " · paused" : ""}
                  </>
                }
                // The row holds two controls, so it is not itself a button: the
                // switch flips the job, the chevron opens its details.
                trailing={
                  <>
                    <Switch
                      checked={task.enabled}
                      label={`${task.title} on or off`}
                      onChange={(next) =>
                        void setEnabled({ environmentId, input: { id: task.id, enabled: next } })
                      }
                    />
                    <IconButton
                      icon={ChevronRight}
                      label={`Details for ${task.title}`}
                      size="sm"
                      onClick={() => setSelected(task.id)}
                    />
                  </>
                }
              />
            ))}
          </List>
        )}
      </div>

      {environmentId && newOpen ? (
        <NewAutomationSheet environmentId={environmentId} onClose={() => setNewOpen(false)} />
      ) : null}
      {environmentId && selectedTask ? (
        <AutomationDetailSheet
          environmentId={environmentId}
          task={selectedTask}
          projectTitle={projectTitle(selectedTask)}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
