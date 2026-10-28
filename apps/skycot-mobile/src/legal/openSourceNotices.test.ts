import { describe, expect, it } from "vite-plus/test";

import {
  buildNotices,
  closureHash,
  collectDependencyClosure,
  isPermissive,
} from "../../scripts/openSourceNotices.ts";
import notices from "./openSourceNotices.json";

describe("Open-source licences (C8)", () => {
  const closure = collectDependencyClosure();

  it("lists every package the app ships, at the installed version", () => {
    const listed = new Set(notices.packages.map((p) => `${p.name}@${p.version}`));
    const missing = [...closure.keys()].filter((key) => !listed.has(key));
    const extra = [...listed].filter((key) => !closure.has(key));
    expect(
      { missing, extra },
      "run: pnpm --filter @t3tools/skycot-mobile licences:generate",
    ).toEqual({ missing: [], extra: [] });
    expect(notices.closureHash).toBe(closureHash(closure.keys()));
  });

  it("matches what the generator would write now", () => {
    expect(JSON.parse(JSON.stringify(buildNotices()))).toEqual(notices);
  });

  it("has a licence text for every package", () => {
    for (const p of notices.packages) {
      expect((notices.texts as Record<string, string>)[p.text]?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it("ships nothing under a GPL-family licence alone", () => {
    const copyleft = notices.packages.filter(
      (p) => /\b(A|L)?GPL/i.test(p.license) && !isPermissive(p.license),
    );
    expect(copyleft.map((p) => `${p.name}@${p.version} ${p.license}`)).toEqual([]);
  });
});
