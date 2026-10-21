import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

export type PopoverPlacement = "bottom-start" | "bottom-end" | "top-start";

export interface PopoverTriggerProps {
  readonly onClick?: () => void;
  readonly "aria-expanded"?: boolean;
  readonly "aria-haspopup"?: "menu" | "dialog";
  readonly "aria-controls"?: string;
}

interface PopoverProps {
  /** The trigger element (usually a Button); the popover clones it with the toggle handler and aria attributes. */
  readonly trigger: ReactElement<PopoverTriggerProps>;
  readonly children: ReactNode | ((close: () => void) => ReactNode);
  readonly placement?: PopoverPlacement;
  readonly role?: "menu" | "dialog";
  readonly label?: string;
}

/**
 * Anchored, non-modal popover. Closes on Escape, outside click, when focus
 * leaves it (Tab), or when the content calls `close()`; focus returns to the
 * trigger on every close that started from the keyboard. The trigger stays in
 * the document flow; the panel is absolutely positioned against it, which
 * keeps it cheap (no layout observers).
 */
export function Popover({
  trigger,
  children,
  placement = "bottom-start",
  role = "menu",
  label,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    const first = panelRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"], [role="menuitemradio"], button, input, [tabindex]:not([tabindex="-1"])',
    );
    (first ?? panelRef.current)?.focus();
    const anchor = anchorRef.current;
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      // Whatever closed the panel, focus must not be left on <body>: the
      // trigger is where the person was before it opened.
      const active = document.activeElement;
      if (active === null || active === document.body || !anchor || anchor.contains(active)) {
        anchor?.querySelector<HTMLElement>("button, [tabindex]")?.focus();
      }
    };
  }, [open]);

  const close = () => setOpen(false);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (role !== "menu" || !panelRef.current) return;
    const items = [
      ...panelRef.current.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemradio"]',
      ),
    ];
    if (items.length === 0) return;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]!.focus();
      return;
    }
    const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const index = items.findIndex((item) => item === document.activeElement);
    items[(index + delta + items.length) % items.length]!.focus();
  };

  // Tab out of the panel closes it; a menu left open behind the focus is a trap.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && anchorRef.current?.contains(next)) return;
    if (next !== null) close();
  };

  return (
    <span className="fm-popover-anchor" ref={anchorRef}>
      {cloneElement(trigger, {
        onClick: () => setOpen((value) => !value),
        "aria-expanded": open,
        "aria-haspopup": role,
        "aria-controls": id,
      })}
      {open ? (
        <div
          id={id}
          ref={panelRef}
          role={role}
          aria-label={label}
          tabIndex={-1}
          className={`fm-popover fm-popover--${placement}`}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </span>
  );
}

/** One row inside a menu Popover. `checked` renders a radio-style tick. */
export function MenuItem({
  children,
  onSelect,
  checked,
  disabled = false,
}: {
  readonly children: ReactNode;
  readonly onSelect: () => void;
  readonly checked?: boolean;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      className="fm-menu-item"
      onClick={onSelect}
      disabled={disabled}
      tabIndex={-1}
    >
      {children}
    </button>
  );
}
