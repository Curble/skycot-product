import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { MoreHorizontal } from "lucide-react";
import type { ReactElement } from "react";

import { filesHref, navigate } from "../../router";
import { useCrew } from "../../themes/useCrew";
import { IconButton } from "../../ui/Button";
import { MenuItem, Popover, type PopoverTriggerProps } from "../../ui/Popover";
import { putAwayBlocked } from "./tidy";
import { useTidy } from "./useTidy";

/**
 * The rows every conversation menu shows (the list's "…", right-click, the header's "…"):
 * See the files, Rename…, then Put away or Bring back. Putting away waits while the crew is
 * working.
 */
export function ConversationMenuItems({
  shell,
  archived,
  onRename,
  close,
}: {
  readonly shell: EnvironmentThreadShell;
  readonly archived: boolean;
  readonly onRename: () => void;
  readonly close: () => void;
}) {
  const tidy = useTidy();
  const crew = useCrew();
  const blocked = archived ? null : putAwayBlocked(shell, crew.builder.name);
  return (
    <>
      <MenuItem
        onSelect={() => {
          close();
          navigate(filesHref(shell.environmentId, shell.projectId, shell.id));
        }}
      >
        See the files
      </MenuItem>
      <MenuItem
        onSelect={() => {
          close();
          onRename();
        }}
      >
        Rename…
      </MenuItem>
      {archived ? (
        <MenuItem
          onSelect={() => {
            close();
            void tidy.bringBack(shell);
          }}
        >
          Bring back
        </MenuItem>
      ) : (
        <MenuItem
          disabled={blocked !== null}
          onSelect={() => {
            close();
            void tidy.putAway(shell);
          }}
        >
          Put away
        </MenuItem>
      )}
      {blocked !== null ? <p className="fm-menu-note">{blocked}</p> : null}
    </>
  );
}

/** A "…" button that opens the conversation menu below it. */
export function ConversationMenuButton({
  shell,
  archived,
  onRename,
  size = "md",
  placement = "bottom-end",
  trigger,
}: {
  readonly shell: EnvironmentThreadShell;
  readonly archived: boolean;
  readonly onRename: () => void;
  readonly size?: "sm" | "md";
  readonly placement?: "bottom-start" | "bottom-end";
  readonly trigger?: ReactElement<PopoverTriggerProps>;
}) {
  return (
    <Popover
      placement={placement}
      label="Conversation"
      trigger={
        trigger ?? (
          <IconButton icon={MoreHorizontal} label="More for this conversation" size={size} />
        )
      }
    >
      {(close) => (
        <ConversationMenuItems
          shell={shell}
          archived={archived}
          onRename={onRename}
          close={close}
        />
      )}
    </Popover>
  );
}
