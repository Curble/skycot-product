// Edit on the person's own earlier messages: a small "Edit" under the bubble (shown on hover
// or focus with a mouse, always on a touch screen) and the bubble's right-click menu. Pressing
// it only asks; the conversation's RewindHost checks whether going back is possible.
import { Pencil } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";

import { ContextMenu, type MenuPoint } from "../../ui/ContextMenu";
import { MenuItem } from "../../ui/Popover";
import { useFamily } from "../family/FamilyProvider";
import { askToEdit } from "./store";

export function EditActions({
  threadId,
  itemId,
  children,
}: {
  readonly threadId: string;
  readonly itemId: string;
  readonly children: (parts: {
    readonly actions: ReactNode;
    readonly onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  }) => ReactNode;
}) {
  const [menuAt, setMenuAt] = useState<MenuPoint | null>(null);
  // A grown-up's device only reads: no Edit there (the engine would refuse going back).
  const readOnly = useFamily().profile.me.kind === "grown-up";
  const edit = () => askToEdit(threadId, itemId);
  if (readOnly) return <>{children({ actions: null, onContextMenu: () => undefined })}</>;
  return (
    <>
      {children({
        actions: (
          <button
            type="button"
            className="fm-msg-edit"
            onClick={edit}
            aria-label="Edit this message and go back to here"
          >
            <Pencil size={11} strokeWidth={2.2} aria-hidden />
            Edit
          </button>
        ),
        onContextMenu: (event) => {
          // Text being selected keeps the browser's own menu (Copy).
          if (window.getSelection()?.toString()) return;
          event.preventDefault();
          setMenuAt({ x: event.clientX, y: event.clientY });
        },
      })}
      <ContextMenu at={menuAt} onClose={() => setMenuAt(null)} label="Message">
        {(close) => (
          <MenuItem
            onSelect={() => {
              close();
              edit();
            }}
          >
            Edit…
          </MenuItem>
        )}
      </ContextMenu>
    </>
  );
}
