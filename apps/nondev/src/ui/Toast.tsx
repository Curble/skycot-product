import { useEffect, useState, useSyncExternalStore } from "react";
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

/**
 * The bottom-centre notice ("Put away · Undo"). Portalled beside the sheets so it stays
 * clickable when a sheet makes the app inert; announced politely to screen readers.
 */
export function ToastHost() {
  const toast = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (toast === null || held) return;
    const timer = window.setTimeout(() => dismissToast(toast.id), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast, held]);
  return createPortal(
    <div className="fm-toast-region" role="status" aria-live="polite">
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
