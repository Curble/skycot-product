import { describe, expect, it } from "vite-plus/test";

import { landsHomeAfterGrownUp, routeForViewer } from "./routeGuard";
import { parseRoute } from "./router";

describe("routeForViewer", () => {
  it("shows a child no page for Who can help or Automations (App renders the nothing-here page, no redirect)", () => {
    for (const hash of ["#/people", "#/automations"]) {
      expect(routeForViewer(parseRoute(hash), true)).toEqual({ allowed: false });
    }
  });

  it("lets a grown-up (or the profile being off) open them", () => {
    expect(routeForViewer(parseRoute("#/people"), false)).toEqual({ allowed: true });
    expect(routeForViewer(parseRoute("#/automations"), false)).toEqual({ allowed: true });
  });

  it("leaves a child's own pages alone", () => {
    for (const hash of ["#/", "#/makes", "#/fridge", "#/stickers", "#/settings/appearance"]) {
      expect(routeForViewer(parseRoute(hash), true)).toEqual({ allowed: true });
    }
  });
});

describe("landsHomeAfterGrownUp", () => {
  it("sends the child Home only when a grown-up's turn has just ended", () => {
    expect(landsHomeAfterGrownUp(true, false)).toBe(true);
    expect(landsHomeAfterGrownUp(false, false)).toBe(false);
    expect(landsHomeAfterGrownUp(false, true)).toBe(false);
    expect(landsHomeAfterGrownUp(true, true)).toBe(false);
  });
});
