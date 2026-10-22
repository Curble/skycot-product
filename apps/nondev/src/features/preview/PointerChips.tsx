// The things pointed at in the preview, waiting above the message box: "the big pink title",
// with the picker's small picture when it took one. Each goes with the next message as words;
// the picture stays here (it is never sent, so the shield has nothing to ask about).
import { MousePointerClick, X } from "lucide-react";

import { removePointer, type PointerDraft } from "./store";

export function PointerChips({
  threadId,
  pointers,
  disabled,
}: {
  readonly threadId: string;
  readonly pointers: ReadonlyArray<PointerDraft>;
  readonly disabled: boolean;
}) {
  if (pointers.length === 0) return null;
  return (
    <ul className="fm-pointer-chips" aria-label="Pointing at">
      {pointers.map((draft) => (
        <li key={draft.id} className="fm-pointer-chip">
          {draft.picture ? (
            <img className="fm-pointer-chip__picture" src={draft.picture} alt="" />
          ) : (
            <MousePointerClick size={14} strokeWidth={1.8} aria-hidden />
          )}
          <span className="fm-pointer-chip__label">{draft.pointer.label}</span>
          <button
            type="button"
            className="fm-pointer-chip__remove"
            aria-label={`Stop pointing at ${draft.pointer.label}`}
            disabled={disabled}
            onClick={() => removePointer(threadId, draft.id)}
          >
            <X size={12} strokeWidth={2.2} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
