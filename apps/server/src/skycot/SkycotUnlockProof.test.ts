// Regression (beta 35): the Mac app's page is not on the engine's origin, so the grown-up proof
// travels as a header; the cookie stays a fallback. These pin which one the engine reads.
import { assert, describe, it } from "@effect/vitest";

import { browserApiCorsAllowedHeaders } from "../httpCors.ts";
import * as SkycotFamily from "./SkycotFamily.ts";
import { unlockTokenFrom } from "./SkycotFamilyHttp.ts";

const HEADER = SkycotFamily.UNLOCK_HEADER_NAME;
const COOKIE = SkycotFamily.UNLOCK_COOKIE_NAME;

describe("the grown-up proof a request carries", () => {
  it("reads the header when only the header is there", () => {
    assert.equal(
      unlockTokenFrom({ headers: { [HEADER]: "from-header" }, cookies: {} }),
      "from-header",
    );
  });

  it("reads the cookie when only the cookie is there", () => {
    assert.equal(
      unlockTokenFrom({ headers: {}, cookies: { [COOKIE]: "from-cookie" } }),
      "from-cookie",
    );
  });

  it("prefers the header when both are present", () => {
    assert.equal(
      unlockTokenFrom({
        headers: { [HEADER]: "from-header" },
        cookies: { [COOKIE]: "from-cookie" },
      }),
      "from-header",
    );
  });

  it("treats an empty header as absent and falls back to the cookie", () => {
    assert.equal(
      unlockTokenFrom({ headers: { [HEADER]: "" }, cookies: { [COOKIE]: "from-cookie" } }),
      "from-cookie",
    );
  });

  it("finds nothing when neither is present", () => {
    assert.isUndefined(unlockTokenFrom({ headers: {}, cookies: {} }));
    assert.isUndefined(unlockTokenFrom({ headers: { [HEADER]: undefined }, cookies: {} }));
  });

  it("ignores cookies and headers of other names", () => {
    assert.isUndefined(
      unlockTokenFrom({ headers: { "x-other": "nope" }, cookies: { session: "nope" } }),
    );
  });
});

describe("browser cross-origin rules", () => {
  it("allow the unlock header so the Mac app's preflight (permission check) passes", () => {
    assert.include(browserApiCorsAllowedHeaders as ReadonlyArray<string>, HEADER);
    assert.include(browserApiCorsAllowedHeaders as ReadonlyArray<string>, "authorization");
    assert.include(browserApiCorsAllowedHeaders as ReadonlyArray<string>, "content-type");
  });
});
