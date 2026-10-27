import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { MoreHorizontal } from "lucide-react";

import { IconButton } from "../../ui/Button";
import { MenuItem } from "../../ui/Popover";
import type { MenuPoint } from "../../ui/ContextMenu";
import type { ProjectSheetFocus } from "./ProjectSheet";

/** The rows a project's menu shows (the sidebar row's "…" and right-click). */
export function ProjectMenuItems({
  onEdit,
  onPutAway,
  close,
}: {
  readonly onEdit: (focus: ProjectSheetFocus) => void;
  /** The child's "Put away": hides the project from the lists (a grown-up brings it back). */
  readonly onPutAway?: () => void;
  readonly close: () => void;
}) {
  return (
    <>
      <MenuItem
        onSelect={() => {
          close();
          onEdit("name");
        }}
      >
        Rename…
      </MenuItem>
      <MenuItem
        onSelect={() => {
          close();
          onEdit("icon");
        }}
      >
        Change icon…
      </MenuItem>
      {onPutAway ? (
        <MenuItem
          onSelect={() => {
            close();
            onPutAway();
          }}
        >
          Put away
        </MenuItem>
      ) : null}
    </>
  );
}

/**
 * The row's "…": opens the same menu a right-click does, just under the button. A menu at a
 * point (portalled), not a popover, so the sidebar's scrolling never clips it.
 */
export function ProjectMenuButton({
  project,
  onOpen,
  expanded,
}: {
  readonly project: Pick<EnvironmentProject, "title">;
  readonly onOpen: (at: MenuPoint) => void;
  readonly expanded: boolean;
}) {
  return (
    <IconButton
      icon={MoreHorizontal}
      label={`More for ${project.title}`}
      size="sm"
      aria-haspopup="menu"
      aria-expanded={expanded}
      onClick={(event) => {
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onOpen({ x: rect.left, y: rect.bottom + 4 });
      }}
    />
  );
}
