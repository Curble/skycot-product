// Edit on the person's own earlier messages: a small "Edit" under the bubble (shown on hover
// or focus with a mouse, always on a touch screen) and the bubble's right-click menu. Pressing
// it only asks; the conversation's RewindHost checks whether going back is possible.
import { Pencil, Undo2 } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";

import { ContextMenu, type MenuPoint } from "../../ui/ContextMenu";
import { MenuItem } from "../../ui/Popover";
import { useFamily } from "../family/FamilyProvider";
import { useAtomCommand } from "~/state/use-atom-command";

import type { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";

import { threadEnvironment } from "../../state/threads";
import { useCrew } from "../../themes/useCrew";
import { showToast } from "../../ui/Toast";
import { editableText, takeBackProblem, takeBackToast } from "./rewind";
import { askToEdit, putBackInBox } from "./store";

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

/**
 * Take back a message that is still lined up: the engine drops the waiting run (its own
 * cancel, nothing else), the words go back in the message box, and sending them again is an
 * ordinary send, so every rule applies again. A grown-up's device only reads.
 */
export function TakeBackActions({
  environmentId,
  threadId,
  runId,
  text,
  pictures,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly text: string;
  readonly pictures: number;
  readonly children: (parts: {
    readonly actions: ReactNode;
    readonly onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  }) => ReactNode;
}) {
  const [menuAt, setMenuAt] = useState<MenuPoint | null>(null);
  const [busy, setBusy] = useState(false);
  const readOnly = useFamily().profile.me.kind === "grown-up";
  const crew = useCrew();
  const cancel = useAtomCommand(threadEnvironment.cancelQueuedRun, { reportFailure: false });
  const takeBack = async () => {
    if (busy) return;
    setBusy(true);
    const outcome = await cancel({ environmentId, input: { threadId, runId } });
    setBusy(false);
    if (outcome._tag === "Failure") {
      showToast(takeBackProblem(crew.builder.name));
      return;
    }
    putBackInBox(threadId, editableText(text).text);
    showToast(takeBackToast(pictures));
  };
  if (readOnly) return <>{children({ actions: null, onContextMenu: () => undefined })}</>;
  return (
    <>
      {children({
        actions: (
          <button
            type="button"
            className="fm-btn fm-btn--sm fm-msg-take-back"
            onClick={() => void takeBack()}
            disabled={busy}
            aria-label="Take back this lined-up message"
          >
            <Undo2 size={11} strokeWidth={2.2} aria-hidden />
            Take back
          </button>
        ),
        onContextMenu: (event) => {
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
              void takeBack();
            }}
          >
            Take back
          </MenuItem>
        )}
      </ContextMenu>
    </>
  );
}
