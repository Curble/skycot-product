import { ArrowUp, Plus, X } from "lucide-react";
import { useId, useRef, type KeyboardEvent, type ReactNode, type Ref } from "react";

import { useVoiceSettings } from "../voice/browser";
import { MicButton, useVoiceTypingControl, VoiceTypingStatus } from "../voice/VoiceTyping";
import { PICTURE_ACCEPT, type PictureDraft } from "./pictures";

const NO_PICTURES: ReadonlyArray<PictureDraft> = [];

/**
 * The iMessage-style input: round field, blue send arrow, the microphone beside it, and an
 * add-a-picture button when the caller takes pictures. Return sends; Shift-Return makes a new
 * line.
 */
export function MessageField({
  value,
  onChange,
  onSend,
  placeholder,
  disabled = false,
  canSend,
  pictures = NO_PICTURES,
  onAddPictures,
  onRemovePicture,
  autoFocus = false,
  foot,
  label = "Message",
  inputRef,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSend: () => void;
  readonly placeholder: string;
  readonly disabled?: boolean;
  readonly canSend: boolean;
  readonly pictures?: ReadonlyArray<PictureDraft>;
  /** Shows the + button; the chosen files are passed on unfiltered. */
  readonly onAddPictures?: (files: ReadonlyArray<File>) => void;
  readonly onRemovePicture?: (id: string) => void;
  readonly autoFocus?: boolean;
  /** Left/right hints under the field. */
  readonly foot?: { readonly left?: ReactNode; readonly right?: ReactNode };
  readonly label?: string;
  readonly inputRef?: Ref<HTMLTextAreaElement>;
}) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const voiceSettings = useVoiceSettings();
  const voice = useVoiceTypingControl({ value, onChange, disabled });
  const send = () => {
    voice.cancel();
    onSend();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend && !disabled) send();
    }
  };
  return (
    <div>
      {voiceSettings.typing ? <VoiceTypingStatus control={voice} /> : null}
      {pictures.length > 0 ? (
        <ul className="fm-composer__pictures" aria-label="Pictures to send">
          {pictures.map((picture) => (
            <li key={picture.id} className="fm-composer__picture">
              <img src={picture.dataUrl} alt={picture.name} width={56} height={56} />
              {onRemovePicture ? (
                <button
                  type="button"
                  className="fm-composer__picture-remove"
                  aria-label={`Remove ${picture.name}`}
                  disabled={disabled}
                  onClick={() => onRemovePicture(picture.id)}
                >
                  <X size={12} strokeWidth={2.4} aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="fm-composer__field">
        {onAddPictures ? (
          <>
            <button
              type="button"
              className="fm-composer__attach"
              aria-label="Add a picture"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
            >
              <Plus size={16} strokeWidth={1.8} aria-hidden />
            </button>
            <input
              ref={fileRef}
              className="fm-composer__file fm-sr-only"
              type="file"
              accept={PICTURE_ACCEPT}
              multiple
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                // Cleared so choosing the same file again still fires.
                event.currentTarget.value = "";
                if (files.length > 0) onAddPictures(files);
              }}
            />
          </>
        ) : null}
        <div className="fm-composer__input">
          <label htmlFor={id} className="fm-sr-only">
            {label}
          </label>
          <textarea
            ref={inputRef}
            id={id}
            className="fm-composer__textarea"
            rows={1}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            onChange={(event) => {
              // Typing takes over from the microphone; what was heard stays.
              voice.cancel();
              onChange(event.currentTarget.value);
            }}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className="fm-composer__send"
            aria-label="Send"
            disabled={disabled || !canSend}
            onClick={send}
          >
            <ArrowUp size={16} strokeWidth={2.2} aria-hidden />
          </button>
        </div>
        {voiceSettings.typing ? <MicButton control={voice} disabled={disabled} /> : null}
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
