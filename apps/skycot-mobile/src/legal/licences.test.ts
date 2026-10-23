import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

import { MIT_LICENCE_T3_CODE } from "./licences";

describe("About › Based on T3 Code", () => {
  it("shows the repository's MIT licence word for word", () => {
    const licence = NodeFS.readFileSync(
      NodeURL.fileURLToPath(new URL("../../../../LICENSE", import.meta.url)),
      "utf8",
    );
    expect(MIT_LICENCE_T3_CODE).toBe(licence.trimEnd());
    expect(MIT_LICENCE_T3_CODE).toContain("Copyright (c) 2026 T3 Tools Inc.");
  });
});
