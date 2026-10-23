import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useEffect, useRef, useState } from "react";

import { ProjectAvatar } from "../../app/ProjectAvatar";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { TextField } from "../../ui/TextField";
import { MAX_TITLE_LENGTH, cleanTitle } from "../tidy/tidy";
import {
  choiceLabel,
  choiceOf,
  iconChoices,
  iconFor,
  plannedIcon,
  projectChange,
  sameChoice,
  type IconChoice,
} from "./projectIcons";
import { useProjectTidy } from "./useProjectTidy";

export type ProjectSheetFocus = "name" | "icon";

/**
 * "Rename…" and "Change icon…" for a project: one small sheet with both, like a list's info
 * in Reminders. The name is selected so typing replaces it; Return saves, Escape or Cancel
 * leaves everything as it was, and an empty name is refused. The icon grid matches a child's
 * picture picker: a letter on one of the six colours, or a friendly emoji.
 */
export function ProjectSheet({
  project,
  focus,
  onClose,
}: {
  /** Null keeps the sheet closed. */
  readonly project: EnvironmentProject | null;
  readonly focus: ProjectSheetFocus;
  readonly onClose: () => void;
}) {
  if (project === null) return null;
  return <ProjectSheetBody project={project} focus={focus} onClose={onClose} />;
}

function ProjectSheetBody({
  project,
  focus,
  onClose,
}: {
  readonly project: EnvironmentProject;
  readonly focus: ProjectSheetFocus;
  readonly onClose: () => void;
}) {
  const tidy = useProjectTidy();
  const [title, setTitle] = useState(project.title);
  // Null: an icon from Advanced mode the grid does not offer, kept unless one is picked.
  const [choice, setChoice] = useState<IconChoice | null>(() => choiceOf(project.projectIcon));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus === "name") {
      inputRef.current?.select();
      return;
    }
    const grid = gridRef.current;
    (
      grid?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      grid?.querySelector<HTMLElement>("button")
    )?.focus();
  }, [focus]);

  const checked = cleanTitle(title);
  const previewTitle = checked.ok ? checked.title : project.title;
  const preview = {
    title: previewTitle,
    projectIcon: plannedIcon(project, previewTitle, choice),
  };

  const save = async () => {
    const planned = projectChange({ current: project, typed: title, choice });
    if (!planned.ok) {
      setProblem(planned.reason);
      return;
    }
    setBusy(true);
    const outcome = await tidy.apply(project, planned.change);
    setBusy(false);
    if (!outcome.ok) {
      setProblem(outcome.message);
      return;
    }
    onClose();
  };

  const choices = iconChoices(previewTitle);

  return (
    <Sheet
      open
      onClose={onClose}
      art={<ProjectAvatar project={preview} size="xl" />}
      title={focus === "icon" ? "Choose an icon" : "Rename this project"}
      description="The name and icon show in the sidebar, beside its conversations, at the top of each one and in the grown-ups' recap."
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !checked.ok}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <TextField
          label="Name"
          inputRef={inputRef}
          value={title}
          maxLength={MAX_TITLE_LENGTH}
          autoComplete="off"
          spellCheck
          onChange={(event) => {
            setTitle(event.currentTarget.value);
            setProblem(null);
          }}
        />
      </form>
      {problem === null && !checked.ok ? (
        <p className="fm-help" style={{ marginTop: 8 }}>
          {checked.reason}
        </p>
      ) : null}
      <h3 className="fm-project-icons__title">Icon</h3>
      <div className="fm-project-icons" role="radiogroup" aria-label="Icon" ref={gridRef}>
        {choices.map((option) => {
          const selected = sameChoice(option, choice);
          return (
            <button
              key={
                option.kind === "emoji"
                  ? option.emoji
                  : option.kind === "letter"
                    ? option.color
                    : "none"
              }
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={choiceLabel(option, previewTitle)}
              className="fm-project-icons__choice"
              onClick={() => {
                setChoice(option);
                setProblem(null);
              }}
            >
              <ProjectAvatar
                project={{ title: previewTitle, projectIcon: iconFor(option, previewTitle) }}
                size="lg"
              />
            </button>
          );
        })}
      </div>
      {problem ? (
        <div style={{ marginTop: 10 }}>
          <Banner tone="warning">{problem}</Banner>
        </div>
      ) : null}
    </Sheet>
  );
}
