import * as NodeAssert from "node:assert/strict";
import { describe, it } from "node:test";

import { plannedFiles, POSES, staleFiles } from "./sync-brand-assets.ts";

describe("sync-brand-assets", () => {
  it("every shipped brand copy matches nondev/brand/assets", () => {
    NodeAssert.deepEqual(staleFiles(), []);
  });

  it("ships both drawings of every pose and both favicons", () => {
    const targets = plannedFiles().map((file) => file.target);
    for (const pose of POSES) {
      NodeAssert.ok(targets.includes(`apps/nondev/src/assets/brand/mascot-${pose}-day.svg`));
      NodeAssert.ok(targets.includes(`apps/nondev/src/assets/brand/mascot-${pose}-dusk.svg`));
    }
    NodeAssert.ok(targets.includes("apps/nondev/src/assets/brand/favicon-dusk.svg"));
  });
});
