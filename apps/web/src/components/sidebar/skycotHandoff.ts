// nondev-seam: web-advanced-grown-up-menu
// Advanced mode's way back to the simple SKYCOT view, with a note about what the grown-up chose.
// The simple view is a separate page, so the note travels in its address (`?handoff=...`) and the
// simple view runs it once on arrival (apps/nondev/src/features/family/handoff.ts).

/** Written by the simple view when a grown-up opens grown-up mode (per window, cleared on hand back). */
export const GROWN_UP_SESSION_KEY = "skycot:family:grown-up";
const UI_MODE_KEY = "skycot:uiMode";

export type SkycotHandoff = "switch" | "hand-back";

/** True while a grown-up (not a child) is using this window, so the grown-up menu is relevant. */
export function isGrownUpSession(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(GROWN_UP_SESSION_KEY) != null;
  } catch {
    return false;
  }
}

/** Where the simple view lives, with the handoff note when there is one. */
export function simpleViewUrl(handoff?: SkycotHandoff): string {
  return handoff === undefined
    ? "/simple/index.html"
    : `/simple/index.html?handoff=${encodeURIComponent(handoff)}`;
}

/** Leaves Advanced mode (remembering the choice, as "Back to SKYCOT" always did) for the simple view. */
export function goToSimpleView(handoff?: SkycotHandoff): void {
  try {
    window.localStorage.setItem(UI_MODE_KEY, "simple");
  } catch {
    // Storage blocked: nothing to remember.
  }
  window.location.assign(simpleViewUrl(handoff));
}
