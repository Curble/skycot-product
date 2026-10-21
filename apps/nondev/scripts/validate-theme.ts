#!/usr/bin/env node
// Validate one or more SKYCOT theme files with the same schema the app uses.
//   node apps/nondev/scripts/validate-theme.ts path/to/a.theme.json [more…]
// Exit code is the number of files that failed (0 = all good), so CI can run it
// over the library and the community folder.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { parseTheme } from "../src/themes/schema.ts";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error(
    "Usage: node apps/nondev/scripts/validate-theme.ts <file.theme.json> [more files…]",
  );
  process.exit(2);
}

let failed = 0;
for (const file of files) {
  let text: string;
  try {
    text = NodeFS.readFileSync(file, "utf8");
  } catch (error) {
    console.log(
      `✗ ${file}: can't read it (${error instanceof Error ? error.message : String(error)})`,
    );
    failed += 1;
    continue;
  }
  const result = parseTheme(text);
  if (result.ok) {
    const expected = `${result.theme.id}.theme.json`;
    const nameNote =
      NodePath.basename(file) === expected ||
      NodePath.basename(file) === `${result.theme.id}.skycot-theme.json`
        ? ""
        : `  (tip: name the file ${expected} so it matches its id)`;
    console.log(
      `OK ${file}: "${result.theme.name}" (${result.theme.id} v${result.theme.version})${nameNote}`,
    );
  } else {
    failed += 1;
    console.log(`✗ ${file}:`);
    for (const problem of result.problems) console.log(`    - ${problem}`);
  }
}
process.exit(failed);
