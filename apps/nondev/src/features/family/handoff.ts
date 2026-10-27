// The handoff from Advanced mode back to the simple view. Advanced mode (the developer-style
// interface) is a separate page, so when a grown-up chooses "Switch who's using SKYCOT" or
// "Done — hand back" there, it can only leave a note in the address it returns to
// (`/simple/index.html?handoff=switch` or `?handoff=hand-back`). This simple view reads that note
// once on arrival, removes it from the address (so a refresh never repeats it) and does what the
// same menu entry does here. It never carries or grants anything itself: handing back only
// locks, and the child picker is only a screen.
export type Handoff = "switch" | "hand-back";

export const HANDOFF_PARAM = "handoff";

/** The note in an address, or null. Unknown values are ignored. */
export function readHandoff(search: string): Handoff | null {
  const value = new URLSearchParams(search).get(HANDOFF_PARAM);
  return value === "switch" || value === "hand-back" ? value : null;
}

/** The same address without the note. */
export function withoutHandoff(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(HANDOFF_PARAM);
  const rest = params.toString();
  return rest === "" ? "" : `?${rest}`;
}

export interface HandoffActions {
  readonly lock: () => void;
  readonly endSession: () => void;
  readonly openPicker: () => void;
}

export interface HandBackActions extends HandoffActions {
  readonly goHome: () => void;
}

/**
 * "Done — hand back", in one place: lock the grown-up grants, end the grown-up session, open the
 * picker (unless the caller has already chosen the child), and land on Home. The sidebar and the
 * end of set-up both call this, so the two can never drift apart.
 */
export function handBack(actions: HandBackActions, options: { readonly picker?: boolean } = {}) {
  actions.lock();
  actions.endSession();
  if (options.picker !== false) actions.openPicker();
  actions.goHome();
}

/**
 * Runs the note found in `location` once and strips it. Returns what it did (null: nothing).
 * "hand-back" = lock the grown-up grants, end the grown-up session, open the picker (exactly the
 * sidebar's "Done — hand back"); "switch" = only open the picker.
 */
export function consumeHandoff(
  location: Pick<Location, "search" | "pathname" | "hash">,
  replace: (url: string) => void,
  actions: HandoffActions,
): Handoff | null {
  const handoff = readHandoff(location.search);
  if (handoff === null) return null;
  replace(`${location.pathname}${withoutHandoff(location.search)}${location.hash}`);
  if (handoff === "hand-back") {
    actions.lock();
    actions.endSession();
  }
  actions.openPicker();
  return handoff;
}
