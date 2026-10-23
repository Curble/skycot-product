import { useSyncExternalStore } from "react";

// A laptop-height window (a 13-inch MacBook's browser is about 800px tall): screens fold
// their longer explanations away behind a "What does this mean?" so the work stays in view.
const SHORT = "(max-height: 900px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(SHORT);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useShortWindow(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(SHORT).matches,
    () => false,
  );
}
