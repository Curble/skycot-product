import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

import { useAtomCommand } from "~/state/use-atom-command";

import { projectEnvironment } from "../../state/projects";
import { showToast } from "../../ui/Toast";
import { isFamilyRefusal } from "../family/cards";
import type { TidyOutcome } from "../tidy/useTidy";
import type { ProjectChange } from "./projectIcons";

const DIDNT_GO = "That didn't go through. Check your Mac is awake and try again.";

function toastFor(change: ProjectChange): string {
  if (change.title !== undefined && change.projectIcon !== undefined) {
    return "Renamed, with a new icon";
  }
  return change.title !== undefined ? "Renamed" : "Icon changed";
}

/**
 * Renaming a project and changing its icon: the engine's own project fields, so the new name
 * and icon show everywhere at once (sidebar, list, header, project picker, the recap) and on
 * every device. Each change has its Undo in the toast, which puts back exactly what it had.
 */
export function useProjectTidy() {
  const update = useAtomCommand(projectEnvironment.update, { reportFailure: false });

  const apply = async (
    project: Pick<EnvironmentProject, "environmentId" | "id" | "title" | "projectIcon">,
    change: ProjectChange,
    options: { readonly toast?: boolean } = {},
  ): Promise<TidyOutcome> => {
    if (change.title === undefined && change.projectIcon === undefined) return { ok: true };
    const outcome = await update({
      environmentId: project.environmentId,
      input: { projectId: project.id, ...change },
    });
    if (outcome._tag === "Failure") {
      const cause = squashAtomCommandFailure(outcome);
      const message = cause instanceof Error ? cause.message : String(cause);
      return { ok: false, message: isFamilyRefusal(message) ? message : DIDNT_GO };
    }
    if (options.toast !== false) {
      const undo: ProjectChange = {
        ...(change.title === undefined ? {} : { title: project.title }),
        ...(change.projectIcon === undefined ? {} : { projectIcon: project.projectIcon ?? null }),
      };
      showToast(toastFor(change), {
        label: "Undo",
        run: () =>
          apply(
            {
              ...project,
              ...(change.title === undefined ? {} : { title: change.title }),
              ...(change.projectIcon === undefined ? {} : { projectIcon: change.projectIcon }),
            },
            undo,
            { toast: false },
          ),
      });
    }
    return { ok: true };
  };

  return { apply };
}
