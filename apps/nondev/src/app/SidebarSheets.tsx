// The two sheets the sidebar opens live here, above the shell, because the
// sidebar itself comes and goes with the window width (a column at three
// columns, a drawer below). A sheet owned by the sidebar would close the moment
// the window crossed that breakpoint; one owned here stays open.
import type { EnvironmentId } from "@t3tools/contracts";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { AdvancedModeSheet } from "./AdvancedModeSheet";
import { OpenFolderSheet } from "./OpenFolderSheet";

interface FolderRequest {
  readonly environmentId: EnvironmentId;
  readonly onOpened: (projectId: string) => void;
}

type Open =
  | { readonly kind: "folder"; readonly request: FolderRequest }
  | { readonly kind: "advanced" };

export interface SidebarSheets {
  readonly openFolder: (request: FolderRequest) => void;
  readonly openAdvanced: () => void;
}

const SidebarSheetsContext = createContext<SidebarSheets | null>(null);

export function SidebarSheetsHost({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null);
  const api = useMemo<SidebarSheets>(
    () => ({
      openFolder: (request) => setOpen({ kind: "folder", request }),
      openAdvanced: () => setOpen({ kind: "advanced" }),
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
    </SidebarSheetsContext.Provider>
  );
}

export function useSidebarSheets(): SidebarSheets {
  const value = useContext(SidebarSheetsContext);
  if (value === null) throw new Error("useSidebarSheets must be used inside SidebarSheetsHost");
  return value;
}
