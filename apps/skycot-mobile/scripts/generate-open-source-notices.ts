// nondev-seam: skycot-iphone-c8-notices-generate
/**
 * Writes src/legal/openSourceNotices.json from the installed dependency tree.
 * Run: pnpm --filter @t3tools/skycot-mobile licences:generate  (after any dependency change).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { APP_DIR, buildNotices, isPermissive } from "./openSourceNotices.ts";

const out = NodePath.join(APP_DIR, "src/legal/openSourceNotices.json");
const notices = buildNotices();
NodeFS.writeFileSync(out, `${JSON.stringify(notices)}\n`);
const odd = notices.packages.filter((p) => !isPermissive(p.license));
console.log(
  `Wrote ${notices.packages.length} packages to ${NodePath.relative(process.cwd(), out)}`,
);
for (const p of odd) console.log(`  CHECK LICENCE: ${p.name}@${p.version} — ${p.license}`);
