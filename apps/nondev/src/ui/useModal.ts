import { useEffect, useInsertionEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Every open modal, oldest first. Only the newest answers Escape and traps
// Tab, so a sheet opened from inside another sheet closes on its own first.
const stack: HTMLElement[] = [];

function appRoot(): HTMLElement | null {
  return document.getElementById("root");
}

/**
 * Where focus goes when a modal closes and its opener is gone (the sheet was
 * shown on load, or the button that opened it unmounted): the main region,
 * which `.fm-content` makes focusable, so keyboard users are not dropped on
 * <body>.
 */
function focusFallback() {
  const main = document.querySelector<HTMLElement>("main");
  main?.focus({ preventScroll: true });
}

/**
 * Modal behaviour shared by sheets and the phone sidebar drawer: focus moves
 * in on open and back to the opener on close, Tab wraps inside, Escape closes
 * (listened at the document, so it works even after a re-render dropped focus
 * to <body>), and the app behind becomes `inert` so screen readers cannot
 * wander out. The element must be portalled outside `#root`.
 */
export function useModal(
  ref: RefObject<HTMLElement | null>,
  {
    open,
    onClose,
    initialFocus = "body",
  }: {
    readonly open: boolean;
    readonly onClose: () => void;
    /** "body" focuses the modal itself so no button is pre-chosen. */
    readonly initialFocus?: "body" | "first";
  },
) {
  // Who to hand focus back to. Recorded before React commits the DOM, because a
  // field that autofocuses inside the modal has already taken focus by the time
  // a layout or passive effect runs and would be mistaken for the opener.
  const openerRef = useRef<Element | null>(null);
  useInsertionEffect(() => {
    if (open) openerRef.current = document.activeElement;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const element = ref.current;
    if (!element) return;
    const opener = openerRef.current;
    stack.push(element);
    const root = appRoot();
    if (stack.length === 1 && root) root.inert = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (initialFocus === "first") {
      (element.querySelector<HTMLElement>(FOCUSABLE) ?? element).focus();
    } else {
      element.focus();
    }
    return () => {
      const index = stack.lastIndexOf(element);
      if (index >= 0) stack.splice(index, 1);
      if (stack.length === 0) {
        document.body.style.overflow = previousOverflow;
        if (root) root.inert = false;
      }
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      else focusFallback();
    };
  }, [open, initialFocus, ref]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const element = ref.current;
      if (!element || stack[stack.length - 1] !== element) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const active = document.activeElement;
      const inside = active instanceof Node && element.contains(active);
      if (focusable.length === 0) {
        event.preventDefault();
        element.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (!inside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (active === first || active === element)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose, ref]);
}
