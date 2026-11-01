// The small box that opens under a changed line: one field, "Add note" and "Cancel".
// Return adds the note, Shift-Return makes a new line, Escape cancels.
import { useEffect, useRef, useState } from "react";

import { Button } from "../../ui/Button";
import { NOTE_MAX_LENGTH } from "./notes";

export function LineNoteEditor({
  label,
  onAdd,
  onCancel,
}: {
  /** "index.html line 12": names the line for screen readers. */
  readonly label: string;
  readonly onAdd: (note: string) => void;
  readonly onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
  }, []);
  const note = text.trim();
  return (
    <div
      className="fm-line-note"
      role="group"
      aria-label={`Note on ${label}`}
      // The viewer treats a press inside the code as selecting lines.
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <textarea
        ref={field}
        className="fm-line-note__field"
        rows={2}
        maxLength={NOTE_MAX_LENGTH}
        value={text}
        placeholder="What should change here?"
        aria-label={`Your note on ${label}`}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (note.length > 0) onAdd(note);
          }
        }}
      />
      <div className="fm-line-note__actions">
        <Button size="sm" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={note.length === 0}
          onClick={() => onAdd(note)}
        >
          Add note
        </Button>
      </div>
    </div>
  );
}
