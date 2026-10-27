// Pages that are grown-up furniture. A child (own device, or the shared Mac before a grown-up's
// code) who types one of these addresses by hand is sent Home with a kind note; the sidebar
// already hides the links, and the engine closes the data behind them, so this is the last door.
import type { Route } from "./router";

export const FOR_GROWN_UPS_NOTE = "That's for grown-ups.";

/** Routes a child must not open; Settings (and the week recap inside it) has its own lock page, and "welcome" asks for the code. */
export function isGrownUpOnlyRoute(route: Route): boolean {
  return route.name === "people" || route.name === "automations";
}

/** Where a route goes for this viewer: itself, or Home with the note. */
export function routeForViewer(
  route: Route,
  childView: boolean,
): { readonly allowed: true } | { readonly allowed: false; readonly note: string } {
  if (childView && isGrownUpOnlyRoute(route)) return { allowed: false, note: FOR_GROWN_UPS_NOTE };
  return { allowed: true };
}
