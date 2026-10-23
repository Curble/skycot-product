import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import {
  SkycotDmgReleaseError,
  codesignIdentityFromCscName,
  parseNotarySubmission,
  replaceFeedFileDigest,
  resolveSkycotDmgRelease,
} from "./mac-dmg-release.ts";

const CSC_NAME = "Mark Hallam (3F72LCWGG2)";

NodeTest.describe("SKYCOT's DMG release plan", () => {
  NodeTest.it(
    "signs with the app's Developer ID certificate and notarises with the profile",
    () => {
      NodeAssert.deepEqual(
        resolveSkycotDmgRelease({ CSC_NAME, APPLE_KEYCHAIN_PROFILE: "skycot-notary" }),
        {
          identity: "Developer ID Application: Mark Hallam (3F72LCWGG2)",
          keychainProfile: "skycot-notary",
          keychain: null,
        },
      );
    },
  );

  NodeTest.it("signs only when there is no keychain profile", () => {
    NodeAssert.equal(resolveSkycotDmgRelease({ CSC_NAME }).keychainProfile, null);
  });

  NodeTest.it("needs CSC_NAME", () => {
    NodeAssert.throws(
      () => resolveSkycotDmgRelease({ APPLE_KEYCHAIN_PROFILE: "skycot-notary" }),
      SkycotDmgReleaseError,
    );
  });

  NodeTest.it("refuses notarisation secrets in the environment", () => {
    for (const name of ["APPLE_API_KEY", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD"]) {
      NodeAssert.throws(
        () =>
          resolveSkycotDmgRelease({
            CSC_NAME,
            APPLE_KEYCHAIN_PROFILE: "skycot-notary",
            [name]: "x",
          }),
        /keychain profile only/u,
      );
    }
  });

  NodeTest.it("reads CSC_NAME the way electron-builder does", () => {
    NodeAssert.equal(
      codesignIdentityFromCscName("Developer ID Application: A (B)"),
      "Developer ID Application: A (B)",
    );
    const hash = "0123456789abcdef0123456789abcdef01234567";
    NodeAssert.equal(codesignIdentityFromCscName(hash), hash);
  });
});

NodeTest.describe("notarytool's answer", () => {
  NodeTest.it("gives the submission id and status", () => {
    NodeAssert.deepEqual(
      parseNotarySubmission(
        '{"id":"cf05d86f","status":"Accepted","message":"Processing complete"}',
      ),
      { id: "cf05d86f", status: "Accepted", message: "Processing complete" },
    );
  });

  NodeTest.it("refuses anything else", () => {
    NodeAssert.throws(() => parseNotarySubmission("Error: no profile"), SkycotDmgReleaseError);
    NodeAssert.throws(() => parseNotarySubmission('{"status":"Accepted"}'), SkycotDmgReleaseError);
  });
});

NodeTest.describe("the feed file after the DMG is stapled", () => {
  const ZIP = "SKYCOT-0.1.1-nondev.1.beta-arm64.zip";
  const DMG = "SKYCOT-0.1.1-nondev.1.beta-arm64.dmg";
  const feed = () => ({
    version: "0.1.1-nondev.1.beta",
    files: [
      { url: ZIP, sha512: "zip", size: 1 },
      { url: DMG, sha512: "old", size: 2 },
    ],
    path: ZIP,
    sha512: "zip",
  });

  NodeTest.it("describes the DMG's final bytes and leaves the zip alone", () => {
    const info = feed();
    NodeAssert.equal(replaceFeedFileDigest(info, DMG, { sha512: "new", size: 3 }), true);
    NodeAssert.deepEqual(info.files, [
      { url: ZIP, sha512: "zip", size: 1 },
      { url: DMG, sha512: "new", size: 3 },
    ]);
    NodeAssert.equal(info.sha512, "zip");
  });

  NodeTest.it("changes nothing for a file the feed does not list", () => {
    const info = feed();
    NodeAssert.equal(replaceFeedFileDigest(info, "other.dmg", { sha512: "new", size: 3 }), false);
    NodeAssert.deepEqual(info, feed());
  });

  NodeTest.it("refuses a feed whose install file is the DMG", () => {
    NodeAssert.throws(
      () => replaceFeedFileDigest({ ...feed(), path: DMG }, DMG, { sha512: "n", size: 3 }),
      SkycotDmgReleaseError,
    );
  });
});
