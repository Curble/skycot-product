// The sheets the sidebar opens live here, above the shell, because the
// sidebar itself comes and goes with the window width (a column at three
// columns, a drawer below). A sheet owned by the sidebar would close the moment
// the window crossed that breakpoint; one owned here stays open.
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { ProjectSheet, type ProjectSheetFocus } from "../features/projects/ProjectSheet";
import { AdvancedModeSheet } from "./AdvancedModeSheet";
import { OpenFolderSheet } from "./OpenFolderSheet";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { navigate, settingsHref } from "../router";
import { useFamily } from "../features/family/FamilyProvider";

interface FolderRequest {
  readonly environmentId: EnvironmentId;
  readonly onOpened: (projectId: string) => void;
}

type Open =
  | { readonly kind: "folder"; readonly request: FolderRequest }
  | { readonly kind: "advanced" }
  | { readonly kind: "child-settings" }
  | {
      readonly kind: "project";
      readonly project: EnvironmentProject;
      readonly focus: ProjectSheetFocus;
    };

export interface SidebarSheets {
  readonly openFolder: (request: FolderRequest) => void;
  readonly openAdvanced: () => void;
  readonly openChildSettings: () => void;
  /** Rename… or Change icon… for a project (one sheet, focused on the name or the icons). */
  readonly editProject: (project: EnvironmentProject, focus: ProjectSheetFocus) => void;
}

const SidebarSheetsContext = createContext<SidebarSheets | null>(null);

export function SidebarSheetsHost({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null);
  const api = useMemo<SidebarSheets>(
    () => ({
      openFolder: (request) => setOpen({ kind: "folder", request }),
      openAdvanced: () => setOpen({ kind: "advanced" }),
      openChildSettings: () => setOpen({ kind: "child-settings" }),
      editProject: (project, focus) => setOpen({ kind: "project", project, focus }),
    }),
    [],
  );
  const close = () => setOpen(null);
  return (
    <SidebarSheetsContext.Provider value={api}>
      {children}
      {open?.kind === "folder" ? (
        <OpenFolderSheet
          open
          onClose={close}
          environmentId={open.request.environmentId}
          onOpened={open.request.onOpened}
        />
      ) : null}
      <AdvancedModeSheet open={open?.kind === "advanced"} onClose={close} />
      <ChildSettingsSheet open={open?.kind === "child-settings"} onClose={close} />
      <ProjectSheet
        key={open?.kind === "project" ? `${open.project.environmentId}:${open.project.id}` : "none"}
        project={open?.kind === "project" ? open.project : null}
        focus={open?.kind === "project" ? open.focus : "name"}
        onClose={close}
      />
    </SidebarSheetsContext.Provider>
  );
}

function ChildSettingsSheet({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const family = useFamily();
  const grownUpSettings = async () => {
    const allowed = await family.requireParentCode("aiSettings");
    if (!allowed) return;
    onClose();
    navigate(settingsHref("family"));
  };
  return (
    <Sheet open={open} onClose={onClose} title="Settings" actions={null}>
      <div className="fm-sidebar-settings">
        <Button
          block
          onClick={() => {
            onClose();
            navigate(settingsHref("appearance"));
          }}
        >
          Appearance
        </Button>
        <Button
          block
          onClick={() => {
            onClose();
            navigate(settingsHref("voice"));
          }}
        >
          Voice
        </Button>
        <Button block onClick={() => void grownUpSettings()}>
          Grown-up settings…
        </Button>
      </div>
    </Sheet>
  );
}

export function useSidebarSheets(): SidebarSheets {
  const value = useContext(SidebarSheetsContext);
  if (value === null) throw new Error("useSidebarSheets must be used inside SidebarSheetsHost");
  return value;
}
