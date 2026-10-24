import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Bell, ChevronDown, ChevronUp, KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import { CREW_NAME } from "../../brand";
import { readLastProject } from "../../state/preferences";
import { environmentProjects } from "../../state/projects";
import { useDefaultAssistantPreference } from "../../state/defaultAssistant";
import { resolveDefaultModelSelection } from "../../state/providers";
import { serverEnvironment } from "../../state/server";
import { environmentThreadShells } from "../../state/threads";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { List, ListExtra, ListRow } from "../../ui/ListRow";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Sheet } from "../../ui/Sheet";
import { StepBadge } from "../../ui/StepBadge";
import { Switch } from "../../ui/Switch";
import { TextField } from "../../ui/TextField";
import { actionReason } from "../family/copy";
import { attemptFor, useFamily } from "../family/FamilyProvider";
import { ParentCodeEntry, useParentCodeEntry } from "../family/ParentCodeEntry";
import {
  DAY_SHORT,
  DEFAULT_SCHEDULE_DRAFT,
  INTERVAL_CHOICES,
  buildSchedule,
  describeSchedule,
  type SchedulePreset,
  type ScheduleDraft,
} from "./schedule";

type Destination = "new" | "same";

export function NewAutomationSheet({
  environmentId,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
}) {
  const projects = useAtomValue(environmentProjects.projectsAtom).filter(
    (project) => project.environmentId === environmentId,
  );
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const preference = useDefaultAssistantPreference(environmentId);
  const threadIndex = useAtomValue(
    environmentThreadShells.environmentThreadIndexAtom(environmentId),
  );
  const upsert = useAtomCommand(serverEnvironment.upsertScheduledTask, { reportFailure: false });

  const remembered = readLastProject();
  const [projectId, setProjectId] = useState<string>(
    (remembered?.environmentId === environmentId &&
    projects.some((project) => project.id === remembered.projectId)
      ? remembered.projectId
      : projects[0]?.id) ?? "",
  );
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<ScheduleDraft>(DEFAULT_SCHEDULE_DRAFT);
  const [destination, setDestination] = useState<Destination>("new");
  const [threadId, setThreadId] = useState<string>("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [webhook, setWebhook] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // With the Family profile on, the form gives way to the code prompt before saving.
  const family = useFamily();
  const needsCode = family.isLocked("createAutomation");
  const [phase, setPhase] = useState<"form" | "code">("form");

  const project = projects.find((entry) => entry.id === projectId) ?? null;
  const modelSelection = resolveDefaultModelSelection(providers, project, preference);
  const threads = [...threadIndex.values()]
    .filter((thread) => thread.projectId === projectId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 20);
  const schedule = webhook ? { type: "webhook" as const, signature: null } : buildSchedule(draft);
  const trimmedPrompt = prompt.trim();
  const derivedTitle = title.trim() || titleFromPrompt(trimmedPrompt);
  const ready =
    project !== null &&
    modelSelection !== null &&
    trimmedPrompt.length > 0 &&
    schedule !== null &&
    (destination === "new" || threadId.length > 0);

  const create = async () => {
    if (!ready || project === null || modelSelection === null || schedule === null) return;
    setPhase("form");
    setBusy(true);
    setProblem(null);
    const outcome = await upsert({
      environmentId,
      input: {
        title: derivedTitle,
        prompt: trimmedPrompt,
        enabled: true,
        schedule,
        projectId: project.id as ProjectId,
        threadId: destination === "same" ? (threadId as ThreadId) : null,
        workspaceStrategy: { type: "root" },
        modelSelection,
        // Automations never get more freedom than "Ask me first": nobody is
        // watching when they run, so every change waits for a person.
        runtimeMode: "approval-required",
        interactionMode: "default",
      },
    });
    setBusy(false);
    if (outcome._tag === "Failure") {
      const cause = squashAtomCommandFailure(outcome);
      setProblem(
        cause instanceof Error
          ? cause.message.split("\n")[0]!
          : "The automation couldn't be saved. Try again.",
      );
      return;
    }
    onClose();
  };
  const codeEntry = useParentCodeEntry(attemptFor("createAutomation", {}), () => void create());

  if (phase === "code") {
    return (
      <Sheet
        open
        onClose={() => setPhase("form")}
        icon={KeyRound}
        iconTone="grey"
        title="Parent code"
        description={actionReason("createAutomation")}
        sober
        initialFocus="first"
        actions={
          <>
            <Button onClick={() => setPhase("form")} disabled={codeEntry.busy}>
              Back
            </Button>
            <Button
              variant="primary"
              disabled={!codeEntry.canSubmit}
              onClick={() => void codeEntry.submit()}
            >
              {codeEntry.busy ? "Checking…" : "Create automation"}
            </Button>
          </>
        }
      >
        <ParentCodeEntry entry={codeEntry} autoFocus />
      </Sheet>
    );
  }

  const presetOptions: ReadonlyArray<{ value: SchedulePreset; label: string }> = [
    { value: "daily", label: "Daily" },
    { value: "weekdays", label: "Weekdays" },
    { value: "weekly", label: "Weekly" },
    { value: "custom", label: "Custom" },
    { value: "interval", label: "Every…" },
  ];

  return (
    <Sheet
      open
      onClose={onClose}
      icon={Bell}
      title="New automation"
      description={`Tell ${CREW_NAME} what to do and when. Each run opens as a conversation that waits for your OK before changing anything.`}
      wide
      initialFocus="first"
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => (needsCode ? setPhase("code") : void create())}
            disabled={!ready || busy}
          >
            {busy ? "Saving…" : needsCode ? "Continue" : "Create automation"}
          </Button>
        </>
      }
      note={
        schedule && !webhook
          ? `Runs ${describeSchedule(schedule)
              .replace(/^Every/, "every")
              .replace(/^Weekdays/, "weekdays")
              .replace(/^Weekends/, "weekends")}, in this Mac's time zone.`
          : undefined
      }
    >
      <div className="fm-form">
        <div>
          <label htmlFor="fm-automation-prompt" className="fm-field-label">
            What should {CREW_NAME} do?
          </label>
          <textarea
            id="fm-automation-prompt"
            className="fm-field fm-textarea"
            rows={3}
            placeholder="Summarise this week's new bookings into a short note I can read on Monday."
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
          />
        </div>

        <TextField
          label="Call it (optional)"
          placeholder={derivedTitle}
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          autoComplete="off"
        />

        <div>
          <label htmlFor="fm-automation-project" className="fm-field-label">
            Which project?
          </label>
          {projects.length === 0 ? (
            <Banner tone="warning">Open a folder as a project first, from the sidebar.</Banner>
          ) : (
            <select
              id="fm-automation-project"
              className="fm-select fm-select--block"
              value={projectId}
              onChange={(event) => {
                setProjectId(event.currentTarget.value);
                setThreadId("");
              }}
            >
              {projects.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
          )}
        </div>

        {!webhook ? (
          <div>
            <span className="fm-field-label">When?</span>
            <SegmentedControl
              label="Schedule"
              value={draft.preset}
              onChange={(preset) => setDraft({ ...draft, preset })}
              block
              size="sm"
              options={presetOptions}
            />
            <div className="fm-form__row">
              {draft.preset === "interval" ? (
                <select
                  className="fm-select"
                  aria-label="How often"
                  value={String(draft.intervalMinutes)}
                  onChange={(event) =>
                    setDraft({ ...draft, intervalMinutes: Number(event.currentTarget.value) })
                  }
                >
                  {INTERVAL_CHOICES.map((choice) => (
                    <option key={choice.minutes} value={String(choice.minutes)}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  {draft.preset === "weekly" ? (
                    <select
                      className="fm-select"
                      aria-label="Which day"
                      value={String(draft.weekdays[0] ?? 1)}
                      onChange={(event) =>
                        setDraft({ ...draft, weekdays: [Number(event.currentTarget.value)] })
                      }
                    >
                      {DAY_SHORT.map((day, index) => (
                        <option key={day} value={String(index)}>
                          {day}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {draft.preset === "custom" ? (
                    <div className="fm-daypicker" role="group" aria-label="Which days">
                      {DAY_SHORT.map((day, index) => {
                        const on = draft.weekdays.includes(index);
                        return (
                          <button
                            key={day}
                            type="button"
                            className={`fm-daypicker__day${on ? " fm-daypicker__day--on" : ""}`}
                            aria-pressed={on}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                weekdays: on
                                  ? draft.weekdays.filter((value) => value !== index)
                                  : [...draft.weekdays, index],
                              })
                            }
                          >
                            {day}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  <label className="fm-inline-field">
                    <span>at</span>
                    <input
                      type="time"
                      className="fm-field fm-field--time"
                      aria-label="Time of day"
                      value={draft.timeOfDay}
                      onChange={(event) =>
                        setDraft({ ...draft, timeOfDay: event.currentTarget.value || "09:00" })
                      }
                    />
                  </label>
                </>
              )}
            </div>
            {draft.preset === "custom" && draft.weekdays.length === 0 ? (
              <p className="fm-help fm-form__hint" role="status">
                Pick at least one day.
              </p>
            ) : null}
          </div>
        ) : null}

        <div>
          <span className="fm-field-label">Where do results go?</span>
          <SegmentedControl<Destination>
            label="Where results go"
            value={destination}
            onChange={setDestination}
            block
            size="sm"
            options={[
              { value: "new", label: "A new conversation each run" },
              { value: "same", label: "The same conversation" },
            ]}
          />
          {destination === "same" ? (
            threads.length === 0 ? (
              <p className="fm-help" style={{ marginTop: 8 }}>
                This project has no conversations yet, so each run will start a new one.
              </p>
            ) : (
              <select
                className="fm-select fm-select--block"
                aria-label="Which conversation"
                style={{ marginTop: 8 }}
                value={threadId}
                onChange={(event) => setThreadId(event.currentTarget.value)}
              >
                <option value="">Choose a conversation…</option>
                {threads.map((thread) => (
                  <option key={thread.id} value={thread.id}>
                    {thread.title}
                  </option>
                ))}
              </select>
            )
          ) : null}
          {destination === "same" && threads.length > 0 && threadId.length === 0 ? (
            <p className="fm-help fm-form__hint" role="status">
              Choose a conversation above.
            </p>
          ) : null}
        </div>

        <List label="Autonomy">
          <ListRow
            leading={<StepBadge state="ok" icon={ShieldCheck} />}
            title="Ask me first"
            subtitle={`Automations always run this way. Nobody is watching when they start, so ${CREW_NAME} prepares the work and waits for you before changing anything.`}
          />
        </List>

        <List label="More options">
          <ListRow
            title="More options"
            subtitle="Start this from another app instead of a schedule."
            trailing={
              moreOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />
            }
            expanded={moreOpen}
            onClick={() => setMoreOpen((value) => !value)}
          />
          {moreOpen ? (
            <>
              <ListRow
                title="Trigger from another app"
                subtitle="Gives this automation a web address. When something calls it, the job runs."
                trailing={
                  <Switch
                    checked={webhook}
                    onChange={setWebhook}
                    label="Trigger from another app"
                  />
                }
              />
              {webhook ? (
                <ListExtra>
                  <div className="fm-sheet-inset">
                    <Banner tone="warning">
                      The address you'll get is a key: anyone who has it can start this automation.
                      It replaces the schedule above.
                    </Banner>
                  </div>
                </ListExtra>
              ) : null}
            </>
          ) : null}
        </List>

        {modelSelection === null && project !== null ? (
          <Banner tone="warning">
            No AI assistant is ready yet. Connect one in Settings first.
          </Banner>
        ) : null}
        {problem ? <Banner tone="danger">{problem}</Banner> : null}
      </div>
    </Sheet>
  );
}

/**
 * A title from the first line of the request, cut at a word boundary so the
 * placeholder never ends mid-word ("…summarise nothi").
 */
export function titleFromPrompt(prompt: string): string {
  const line =
    prompt
      .split("\n")[0]
      ?.trim()
      .replace(/[.:!?]\s*$/, "") ?? "";
  if (line.length === 0) return "Automation";
  if (line.length <= 60) return line;
  const cut = line.slice(0, 60);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > 30 ? cut.slice(0, atWord) : cut).replace(/[,;:\s]+$/, "")}…`;
}
