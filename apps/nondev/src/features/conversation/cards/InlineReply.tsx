import { ArrowUp } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";

/**
 * A short reply field that lives inside a card ("Change the plan", a question
 * answered by message). Return sends, Shift-Return makes a new line, Escape
 * closes it.
 */
export function InlineReply({
  placeholder,
  label,
  sendLabel = "Send",
  busy = false,
  autoFocus = true,
  onSend,
  onCancel,
}: {
  readonly placeholder: string;
  readonly label: string;
  readonly sendLabel?: string;
  readonly busy?: boolean;
  readonly autoFocus?: boolean;
  readonly onSend: (text: string) => void;
  readonly onCancel?: () => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const send = () => {
    if (trimmed.length === 0 || busy) return;
    onSend(trimmed);
    setText("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };
  return (
    <div className="fm-inline-reply">
      <label htmlFor={id} className="fm-sr-only">
        {label}
      </label>
      <textarea
        id={id}
        className="fm-inline-reply__field"
        rows={2}
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        disabled={busy}
        autoFocus={autoFocus}
      />
      <button
        type="button"
        className="fm-inline-reply__send"
        aria-label={sendLabel}
        disabled={trimmed.length === 0 || busy}
        onClick={send}
      >
        <ArrowUp size={15} strokeWidth={2.2} aria-hidden />
      </button>
    </div>
  );
}
