import { describe, expect, it } from "vite-plus/test";

import {
  describeChanges,
  describeFile,
  describeTurnDiff,
  fromCheckpointFiles,
  describeFileChange,
  humanizeFileName,
  named,
  parseUnifiedDiff,
} from "./changes";

const DIFF = `diff --git a/src/pages/booking.tsx b/src/pages/booking.tsx
index 1111111..2222222 100644
--- a/src/pages/booking.tsx
+++ b/src/pages/booking.tsx
@@ -1,4 +1,6 @@
 import React from "react";
+import DatePicker from "react-datepicker";
+import "react-datepicker/dist/react-datepicker.css";
 export function Booking() {
-  return <div>Book</div>;
+  return <DatePicker />;
 }
diff --git a/styles/globals.css b/styles/globals.css
--- a/styles/globals.css
+++ b/styles/globals.css
@@ -1 +1,2 @@
 body { margin: 0; }
+.react-datepicker { font-family: inherit; }
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -5,3 +5,4 @@
   "dependencies": {
+    "react-datepicker": "^7.0.0",
     "react": "^19.0.0"
   }
diff --git a/content/old-notes.md b/content/old-notes.md
deleted file mode 100644
--- a/content/old-notes.md
+++ /dev/null
@@ -1,2 +0,0 @@
-# Old
-notes
diff --git a/src/lib/dates.ts b/src/lib/dates.ts
new file mode 100644
--- /dev/null
+++ b/src/lib/dates.ts
@@ -0,0 +1,3 @@
+export function fmt() {
+  return "x";
+}
diff --git a/public/logo.png b/public/logo.png
Binary files a/public/logo.png and b/public/logo.png differ
diff --git a/src/components/OldButton.tsx b/src/components/NewButton.tsx
similarity index 90%
rename from src/components/OldButton.tsx
rename to src/components/NewButton.tsx
`;

describe("humanizeFileName", () => {
  it.each([
    ["src/pages/booking-form.tsx", "booking form"],
    ["src/components/UserProfileCard.tsx", "user profile card"],
    ["styles/globals.css", "globals"],
    ["README.md", "readme"],
    ["src/lib/dates.test.ts", "dates"],
    ["app/[slug]/page.tsx", "page"],
  ])("%s → %s", (path, expected) => {
    expect(humanizeFileName(path)).toBe(expected);
  });
});

describe("describeFile", () => {
  it.each([
    ["src/pages/booking.tsx", "pages", "the booking page"],
    ["app/dashboard/page.tsx", "pages", "a page"],
    ["src/components/Header.tsx", "pages", "the header building block"],
    ["index.html", "pages", "the home page"],
    ["styles/globals.css", "styles", "the site's overall styling"],
    ["src/theme.ts", "styles", "the theme design settings"],
    ["README.md", "content", "the README notes"],
    ["content/posts/hello.mdx", "content", "the hello text"],
    ["public/logo.png", "content", "the logo image or media file"],
    ["data/prices.json", "content", "the prices data file"],
    [".env", "settings", "the secret settings file"],
    ["package.json", "settings", "the project's add-ons and scripts list"],
    ["vite.config.ts", "settings", "the vite tool settings"],
    ["config/app.yaml", "settings", "the app settings"],
    ["src/lib/dates.ts", "behind the scenes", "the dates behind-the-scenes code"],
    ["src/lib/dates.test.ts", "behind the scenes", "the checks for dates"],
    ["pnpm-lock.yaml", "behind the scenes", "the exact add-on versions list"],
    ["Makefile", "behind the scenes", "the makefile file"],
  ])("%s → %s / %s", (path, area, noun) => {
    const described = describeFile(path);
    expect(described.area).toBe(area);
    expect(described.noun).toBe(noun);
  });

  // A child's own file names (F4): "my-pet.html" is theirs, not "the my pet page".
  it.each([
    ["my-pet.html", "your pet page"],
    ["my_drawing.html", "your drawing page"],
    ["MyRocket.html", "your rocket page"],
    ["our-club.html", "your club page"],
    ["my.html", "your page"],
    ["my-page.html", "your page"],
    ["pet-page.html", "the pet page"],
    ["the-end.html", "the end page"],
    ["bubbles.html", "the bubbles page"],
    ["src/pages/my-games.tsx", "your games page"],
    ["my-styles.css", "the site's overall styling"],
    ["images/my-cat.png", "your cat image or media file"],
    ["src/lib/my-helpers.test.ts", "the checks for your helpers"],
    ["mystery.html", "the mystery page"],
  ])("names %s as %s", (path, noun) => {
    expect(describeFile(path).noun).toBe(noun);
  });

  it("starts a What changed line with a capital, never 'The my'", () => {
    expect(
      describeFileChange({ path: "my-pet.html", operation: "added", additions: 3, deletions: 0 })
        .line,
    ).toBe("Added your pet page (+3 / −0 lines)");
    expect(named("My Pet", "page")).toBe("your Pet page");
  });

  it("flags secrets, config and dependency manifests", () => {
    expect(describeFile(".env.production")).toMatchObject({
      isConfigOrSecret: true,
      isDependencyManifest: false,
    });
    expect(describeFile("package.json")).toMatchObject({
      isConfigOrSecret: true,
      isDependencyManifest: true,
    });
    expect(describeFile("requirements.txt").isDependencyManifest).toBe(true);
    expect(describeFile("src/pages/x.tsx")).toMatchObject({
      isConfigOrSecret: false,
      isDependencyManifest: false,
      isTest: false,
    });
    expect(describeFile("src/x.spec.ts").isTest).toBe(true);
  });
});

describe("parseUnifiedDiff", () => {
  it("reads every file with its operation and line counts", () => {
    const files = parseUnifiedDiff(DIFF);
    expect(files.map((f) => [f.path, f.operation, f.additions, f.deletions])).toEqual([
      ["src/pages/booking.tsx", "edited", 3, 1],
      ["styles/globals.css", "edited", 1, 0],
      ["package.json", "edited", 1, 0],
      ["content/old-notes.md", "deleted", 0, 2],
      ["src/lib/dates.ts", "added", 3, 0],
      ["public/logo.png", "edited", 0, 0],
      ["src/components/NewButton.tsx", "renamed", 0, 0],
    ]);
    expect(files[5]?.binary).toBe(true);
    expect(files[6]?.oldPath).toBe("src/components/OldButton.tsx");
  });

  it("returns nothing for an empty diff", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});

describe("describeChanges", () => {
  it("summarises, groups by area, counts, and flags", () => {
    const what = describeTurnDiff(DIFF);
    expect(what.summary).toBe(
      "Changed 7 files: 2 pages, 1 style file, 2 content files, 1 settings file and 1 behind-the-scenes file (+8 / −3 lines).",
    );
    expect(what.groups.map((g) => [g.area, g.label, g.files.length])).toEqual([
      ["pages", "Pages", 2],
      ["styles", "Look and feel", 1],
      ["content", "Words and images", 2],
      ["settings", "Settings", 1],
      ["behind the scenes", "Behind the scenes", 1],
    ]);
    expect(what.groups[0]!.files.map((f) => f.line)).toEqual([
      "Edited the booking page (+3 / −1 lines)",
      "Renamed the old button building block to the new button building block",
    ]);
    expect(what.counts).toEqual({
      files: 7,
      added: 1,
      edited: 4,
      deleted: 1,
      renamed: 1,
      additions: 8,
      deletions: 3,
    });
    expect(what.flags).toEqual({
      filesDeleted: ["content/old-notes.md"],
      configOrSecretsTouched: ["package.json"],
      dependenciesChanged: ["package.json"],
    });
    expect(what.warnings).toEqual([
      "1 file was deleted.",
      "The project's list of required add-ons changed.",
    ]);
    expect(what.untouched).toBe("Everything else in the project is untouched.");
    for (const group of what.groups) {
      for (const file of group.files) expect(file.line).not.toMatch(/[\w.-]+\/[\w.-]+/);
    }
  });

  it("warns separately about settings files that are not dependency manifests", () => {
    const what = describeChanges([
      { path: ".env", operation: "edited", additions: 1, deletions: 1 },
    ]);
    expect(what.warnings).toEqual(["Settings or secret files were changed — worth a second look."]);
    expect(what.summary).toBe("Changed 1 file: 1 settings file (+1 / −1 lines).");
  });

  it("describes an all-new or empty change set", () => {
    expect(
      describeChanges([{ path: "a.css", operation: "added", additions: 4, deletions: 0 }]).summary,
    ).toBe("Added 1 file: 1 style file (+4 / −0 lines).");
    const empty = describeChanges([]);
    expect(empty.summary).toBe("Nothing changed.");
    expect(empty.untouched).toBe("Nothing changed.");
    expect(empty.groups).toEqual([]);
  });

  it("accepts checkpoint file summaries", () => {
    const changes = fromCheckpointFiles([
      { path: "src/pages/home.tsx", kind: "A", additions: 10, deletions: 0 },
      { path: "src/pages/about.tsx", kind: "D", additions: 0, deletions: 20 },
      { path: "styles/app.css", kind: "modified", additions: 2, deletions: 2 },
    ]);
    expect(changes.map((c) => c.operation)).toEqual(["added", "deleted", "edited"]);
    expect(describeChanges(changes).summary).toBe(
      "Changed 3 files: 2 pages and 1 style file (+12 / −22 lines).",
    );
  });
});
