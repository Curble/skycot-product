import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

export interface ToastAction {
  readonly label: string;
  readonly run: () => void | Promise<unknown>;
}

interface ToastValue {
  readonly id: number;
  readonly message: string;
  readonly action: ToastAction | null;
}

/** Long enough to read and reach for Undo; a pointer resting on the toast keeps it. */
export const TOAST_MS = 7_000;

let current: ToastValue | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** One toast at a time, like the Finder's: a new one replaces the last. */
export function showToast(message: string, action: ToastAction | null = null): void {
  current = { id: nextId++, message, action };
  emit();
}

export function dismissToast(id?: number): void {
  if (current === null || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

/** Space between the toast and what it must not cover. */
const TOAST_GAP = 12;

export interface ToastPlace {
  /** px from the window's bottom. */
  readonly bottom: number;
  /** px from the window's left: the middle of the message box's column. */
  readonly center: number;
}

/**
 * Where the toast sits so it clears the message box and whatever shares its strip (the
 * put-away banner lives there too), centred over that column. Null when no message box is on
 * screen: the stylesheet's own place, which respects the safe area, applies.
 */
export function toastPlace(
  windowHeight: number,
  avoid: ReadonlyArray<{
    readonly top: number;
    readonly left: number;
    readonly width: number;
    readonly height: number;
  }>,
): ToastPlace | null {
  const shown = avoid.filter((rect) => rect.height > 0 && rect.top < windowHeight);
  if (shown.length === 0) return null;
  const highest = shown.reduce((a, b) => (b.top < a.top ? b : a));
  return {
    bottom: Math.max(0, windowHeight - highest.top) + TOAST_GAP,
    center: highest.left + highest.width / 2,
  };
}

function useToastPlace(active: boolean): ToastPlace | null {
  const [place, setPlace] = useState<ToastPlace | null>(null);
  useLayoutEffect(() => {
    if (!active) return;
    const measure = () => {
      const avoid = [...document.querySelectorAll<HTMLElement>(".fm-composer")].map((node) =>
        node.getBoundingClientRect(),
      );
      setPlace(toastPlace(window.innerHeight, avoid));
    };
    // The message box grows with what is typed, a phone keyboard moves it, and "Put away"
    // swaps the conversation's box for Home's: watch only while a toast is showing, and
    // measure once per burst of changes.
    const resized = new ResizeObserver(measure);
    const watch = () => {
      resized.disconnect();
      for (const node of document.querySelectorAll(".fm-composer")) resized.observe(node);
      measure();
    };
    let pending: number | null = null;
    const swapped = new MutationObserver(() => {
      if (pending === null)
        pending = window.setTimeout(() => {
          pending = null;
          watch();
        }, 50);
    });
    watch();
    swapped.observe(document.querySelector(".fm-shell") ?? document.body, {
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      if (pending !== null) window.clearTimeout(pending);
      resized.disconnect();
      swapped.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [active]);
  return active ? place : null;
}

/**
 * The bottom-centre notice ("Put away · Undo"), lifted above the message box so it never
 * covers what is being typed or the banner in its place. Portalled beside the sheets so it stays
 * clickable when a sheet makes the app inert; announced politely to screen readers.
 */
export function ToastHost() {
  const toast = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const [held, setHeld] = useState(false);
  const place = useToastPlace(toast !== null);
  useEffect(() => {
    if (toast === null || held) return;
    const timer = window.setTimeout(() => dismissToast(toast.id), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast, held]);
  return createPortal(
    <div
      className="fm-toast-region"
      role="status"
      aria-live="polite"
      style={
        place === null ? undefined : { bottom: `${place.bottom}px`, left: `${place.center}px` }
      }
    >
      {toast ? (
        <div
          key={toast.id}
          className="fm-toast"
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
        >
          <span className="fm-toast__message">{toast.message}</span>
          {toast.action ? (
            <>
              <span className="fm-toast__dot" aria-hidden>
                ·
              </span>
              <button
                type="button"
                className="fm-toast__action"
                onClick={() => {
                  const action = toast.action!;
                  dismissToast(toast.id);
                  setHeld(false);
                  void action.run();
                }}
              >
                {toast.action.label}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
