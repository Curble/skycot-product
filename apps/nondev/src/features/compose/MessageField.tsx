import { ArrowUp, Plus } from "lucide-react";
import { useId, type KeyboardEvent, type ReactNode } from "react";

/**
 * The iMessage-style input: round field, blue send arrow, optional attach
 * button. Return sends; Shift-Return makes a new line.
 */
export function MessageField({
  value,
  onChange,
  onSend,
  placeholder,
  disabled = false,
  canSend,
  attach = false,
  onAttach,
  autoFocus = false,
  foot,
  label = "Message",
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSend: () => void;
  readonly placeholder: string;
  readonly disabled?: boolean;
  readonly canSend: boolean;
  /** Room for an attach button; it only renders once `onAttach` does something. */
  readonly attach?: boolean;
  readonly onAttach?: () => void;
  readonly autoFocus?: boolean;
  /** Left/right hints under the field. */
  readonly foot?: { readonly left?: ReactNode; readonly right?: ReactNode };
  readonly label?: string;
}) {
  const id = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend && !disabled) onSend();
    }
  };
  return (
    <div>
      <div className="fm-composer__field">
        {attach && onAttach ? (
          <button
            type="button"
            className="fm-composer__attach"
            aria-label="Attach a picture"
            disabled={disabled}
            onClick={onAttach}
          >
            <Plus size={16} strokeWidth={1.8} aria-hidden />
          </button>
        ) : null}
        <div className="fm-composer__input">
          <label htmlFor={id} className="fm-sr-only">
            {label}
          </label>
          <textarea
            id={id}
            className="fm-composer__textarea"
            rows={1}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            onChange={(event) => onChange(event.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className="fm-composer__send"
            aria-label="Send"
            disabled={disabled || !canSend}
            onClick={onSend}
          >
            <ArrowUp size={16} strokeWidth={2.2} aria-hidden />
          </button>
        </div>
      </div>
      {foot ? (
        <div className="fm-composer__foot">
          <span>{foot.left}</span>
          <span>{foot.right}</span>
        </div>
      ) : null}
    </div>
  );
}
