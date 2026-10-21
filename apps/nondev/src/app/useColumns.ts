import { useSyncExternalStore } from "react";

export type Columns = 1 | 2 | 3;

// Three columns (sidebar · list · content) by default, two under 1000px, one
// under 700px. matchMedia fires only when a breakpoint is crossed, unlike a
// resize listener.
const TWO = "(max-width: 999px)";
const ONE = "(max-width: 699px)";

function subscribe(onChange: () => void) {
  const two = window.matchMedia(TWO);
  const one = window.matchMedia(ONE);
  two.addEventListener("change", onChange);
  one.addEventListener("change", onChange);
  return () => {
    two.removeEventListener("change", onChange);
    one.removeEventListener("change", onChange);
  };
}

function snapshot(): Columns {
  if (window.matchMedia(ONE).matches) return 1;
  if (window.matchMedia(TWO).matches) return 2;
  return 3;
}

export function useColumns(): Columns {
  return useSyncExternalStore(subscribe, snapshot, () => 3);
}
