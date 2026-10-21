import type { LucideIcon } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useModal } from "./useModal";

export type SheetIconTone = "blue" | "orange" | "red" | "grey";

interface SheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: ReactNode;
  readonly icon?: LucideIcon;
  readonly iconTone?: SheetIconTone;
  readonly children?: ReactNode;
  /** Buttons, right-aligned. Nothing is pre-selected: pass `initialFocus="body"` to keep it so. */
  readonly actions?: ReactNode;
  readonly note?: ReactNode;
  readonly wide?: boolean;
  /** Where focus lands on open. "body" focuses the sheet itself so no button is pre-chosen. */
  readonly initialFocus?: "body" | "first";
  readonly dismissOnBackdrop?: boolean;
}

/**
 * macOS-style modal sheet. Traps focus, closes on Escape (even when focus has
 * fallen to <body>), restores focus to the opener, makes the app behind it
 * inert, and portals to <body> so it escapes any overflow clipping. Taller
 * than the window, the body scrolls and the actions stay pinned.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  icon: Icon,
  iconTone = "blue",
  children,
  actions,
  note,
  wide = false,
  initialFocus = "body",
  dismissOnBackdrop = true,
}: SheetProps) {
  const titleId = useId();
  const descriptionId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  useModal(sheetRef, { open, onClose, initialFocus });

  if (!open) return null;

  return createPortal(
    <div
      className="fm-sheet-backdrop"
      onMouseDown={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`fm-sheet${wide ? " fm-sheet--wide" : ""}`}
      >
        <div className="fm-sheet__top">
          {Icon ? (
            <span className={`fm-sheet__icon fm-sheet__icon--${iconTone}`} aria-hidden>
              <Icon size={28} strokeWidth={1.7} />
            </span>
          ) : null}
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 id={titleId} className="fm-sheet__title">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="fm-sheet__description">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {children ? <div className="fm-sheet__body">{children}</div> : null}
        {actions ? <div className="fm-sheet__actions">{actions}</div> : null}
        {note ? <p className="fm-sheet__note">{note}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
