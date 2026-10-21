import { useEffect } from "react";

/**
 * Escape always cancels a sheet, even after focus has left it (a choice card
 * that unmounts, a blur). ui/Sheet handles the key only while focus is inside
 * the dialog and stops propagation, so this document-level fallback never
 * fires twice for the same press.
 */
export function useEscapeToClose(enabled: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, onClose]);
}
