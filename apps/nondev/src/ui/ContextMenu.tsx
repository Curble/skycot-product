import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuPoint {
  readonly x: number;
  readonly y: number;
}

const EDGE = 8;

/**
 * The right-click menu: opens at the pointer, nudged inside the window, with the same rows
 * and keys as a menu Popover (arrows, Home/End, Escape). Closes on an outside click, a scroll
 * or resize, or when focus leaves it, and hands focus back to where it was.
 */
export function ContextMenu({
  at,
  onClose,
  label,
  children,
}: {
  readonly at: MenuPoint | null;
  readonly onClose: () => void;
  readonly label: string;
  readonly children: (close: () => void) => ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Nudged inside the window before paint, once its size is known.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (at === null || panel === null) return;
    const { width, height } = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(EDGE, Math.min(at.x, window.innerWidth - width - EDGE))}px`;
    panel.style.top = `${Math.max(EDGE, Math.min(at.y, window.innerHeight - height - EDGE))}px`;
  }, [at]);

  useEffect(() => {
    if (at === null) return;
    const opener = document.activeElement;
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    const onAway = () => onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onAway);
    window.addEventListener("blur", onAway);
    document.addEventListener("scroll", onAway, true);
    panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onAway);
      window.removeEventListener("blur", onAway);
      document.removeEventListener("scroll", onAway, true);
      const active = document.activeElement;
      if (
        opener instanceof HTMLElement &&
        opener.isConnected &&
        (active === null || active === document.body)
      ) {
        opener.focus();
      }
    };
  }, [at, onClose]);

  if (at === null) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const items = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ??
        []),
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

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      className="fm-popover fm-context-menu"
      style={{ left: at.x, top: at.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children(onClose)}
    </div>,
    document.body,
  );
}
