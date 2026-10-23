import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { useCrew } from "../../themes/useCrew";

/**
 * What a go-back replaced, folded into one quiet row in the stream while the conversation
 * stays open ("Show" opens it, read-only and faded). The engine leaves taken-back turns out
 * when the conversation is opened again, so the row is a "this just happened", not an archive.
 */
export function TakenBackFold({
  messages,
  children,
}: {
  /** The person's own messages inside the fold. */
  readonly messages: number;
  readonly children: ReactNode;
}) {
  const crew = useCrew();
  const [open, setOpen] = useState(false);
  const id = useId();
  // Undo and "Go back to here" both take turns back; the words fit either.
  const what =
    messages <= 1
      ? "a message and its reply were taken back"
      : `${messages} messages and their replies were taken back`;
  return (
    <div className="fm-takenback">
      <button
        type="button"
        className="fm-takenback__row"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <RotateCcw size={13} strokeWidth={2} aria-hidden />
        <span className="fm-takenback__what">
          Went back: {what}. {crew.builder.name} doesn't remember them.
        </span>
        <span className="fm-takenback__toggle">
          {open ? "Hide" : "Show"}
          {open ? (
            <ChevronDown size={13} strokeWidth={2} aria-hidden />
          ) : (
            <ChevronRight size={13} strokeWidth={2} aria-hidden />
          )}
        </span>
      </button>
      {open ? (
        <div id={id} className="fm-takenback__body" aria-label="Replaced messages">
          {children}
        </div>
      ) : null}
    </div>
  );
}
