import { describe, expect, it } from "vite-plus/test";

import { FOR_GROWN_UPS_NOTE, routeForViewer } from "./routeGuard";
import { parseRoute } from "./router";

describe("routeForViewer", () => {
  it("sends a child away from Who can help and Automations by address", () => {
    for (const hash of ["#/people", "#/automations"]) {
      expect(routeForViewer(parseRoute(hash), true)).toEqual({
        allowed: false,
        note: FOR_GROWN_UPS_NOTE,
      });
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
