import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import {
  createStagePatchedDependencies,
  pinnedPatchedDependencies,
} from "../../scripts/build-desktop-artifact.ts";

// Beta 3 (24 October 2026): the staged install has no lockfile, so `^1.2.0-beta.15` took
// node-pty 1.2.0-beta.18 and the beta.15 patch failed the build. A patched dependency is pinned.
NodeTest.test("a patched dependency is staged at exactly the version its patch names", () => {
  const patches = createStagePatchedDependencies(
    {
      "node-pty@1.2.0-beta.15": "patches/node-pty@1.2.0-beta.15.patch",
      "@scope/thing@2.0.0": "patches/@scope__thing@2.0.0.patch",
      "not-staged@1.0.0": "patches/not-staged@1.0.0.patch",
    },
    { "node-pty": "^1.2.0-beta.15", "@scope/thing": "^2.0.0", other: "^3.0.0" },
  );
  NodeAssert.deepEqual(pinnedPatchedDependencies(patches), {
    "node-pty": "1.2.0-beta.15",
    "@scope/thing": "2.0.0",
  });
});
