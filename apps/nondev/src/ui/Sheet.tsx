import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

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

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * macOS-style modal sheet. Traps focus, closes on Escape, restores focus to
 * the opener, and portals to <body> so it escapes any overflow clipping.
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
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    const sheet = sheetRef.current;
    if (sheet) {
      if (initialFocus === "first") {
        const first = sheet.querySelector<HTMLElement>(FOCUSABLE);
        (first ?? sheet).focus();
      } else {
        sheet.focus();
      }
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open, initialFocus]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !sheetRef.current) return;
    const focusable = [...sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === sheetRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

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
        onKeyDown={onKeyDown}
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
