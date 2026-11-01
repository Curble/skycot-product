// The notes waiting above the message box: "Note on index.html line 12", each with an x. They go
// with the next message as words (see notes.ts).
import { MessageSquareText, X } from "lucide-react";

import { fileNameOf, removeLineNote, type LineNote } from "./notes";

export function LineNoteChips({
  threadId,
  notes,
  disabled,
}: {
  readonly threadId: string;
  readonly notes: ReadonlyArray<LineNote>;
  readonly disabled: boolean;
}) {
  if (notes.length === 0) return null;
  return (
    <ul
      className="fm-pointer-chips fm-line-note-chips"
      aria-label={`${notes.length} ${notes.length === 1 ? "note" : "notes"} on the code`}
    >
      {notes.map((entry) => {
        const label = `Note on ${fileNameOf(entry.path)} line ${entry.line}`;
        return (
          <li key={entry.id} className="fm-pointer-chip" title={entry.note}>
            <MessageSquareText size={14} strokeWidth={1.8} aria-hidden />
            <span className="fm-pointer-chip__label">{label}</span>
            <button
              type="button"
              className="fm-pointer-chip__remove"
              aria-label={`Remove: ${label}`}
              disabled={disabled}
              onClick={() => removeLineNote(threadId, entry.id)}
            >
              <X size={12} strokeWidth={2.2} aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
