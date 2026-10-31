// Pages that are grown-up furniture. A child (own device, or the shared Mac before a grown-up's
// code) who types one of these addresses by hand sees the same "There's nothing here" page as for
// any unknown address (no redirect, no hint the page exists); the sidebar already hides the links,
// and the engine closes the data behind them, so this is the last door.
import type { Route } from "./router";

/** Routes a child must not open; Settings (and the week recap inside it) has its own lock page, and "welcome" asks for the code. */
export function isGrownUpOnlyRoute(route: Route): boolean {
  return route.name === "people" || route.name === "automations";
}

/** Where a route goes for this viewer: itself, or the "nothing here" page. */
export function routeForViewer(
  route: Route,
  childView: boolean,
): { readonly allowed: true } | { readonly allowed: false } {
  if (childView && isGrownUpOnlyRoute(route)) return { allowed: false };
  return { allowed: true };
}

/** A grown-up's turn just ended (hand back, Done, or the code lapsed): the child lands Home, whatever page the grown-up was on. */
export function landsHomeAfterGrownUp(wasGrownUp: boolean, isGrownUp: boolean): boolean {
  return wasGrownUp && !isGrownUp;
}
