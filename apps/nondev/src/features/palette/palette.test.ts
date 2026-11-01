import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import {
  RECENT_LIMIT,
  filterItems,
  isPaletteShortcut,
  moveSelection,
  paletteAvailable,
  paletteItems,
  type PaletteSources,
} from "./palette";

const env = "env-1" as EnvironmentId;
const sources = (over: Partial<PaletteSources> = {}): PaletteSources => ({
  columns: 3,
  projects: [
    { environmentId: env, id: "p-1" as ProjectId, title: "Garden game", projectKey: "env-1:p-1" },
    {
      environmentId: env,
      id: "p-2" as ProjectId,
      title: "Questions",
      projectKey: "env-1:p-2",
      isScratch: true,
    },
  ],
  conversations: Array.from({ length: 12 }, (_, index) => ({
    environmentId: env,
    id: `t-${index}` as ThreadId,
    title: `Chat ${index}`,
    projectTitle: "Garden game",
  })),
  ...over,
});

describe("palette availability", () => {
  it("is only for a grown-up with the Family profile off", () => {
    expect(paletteAvailable({ childView: false, familyOn: false })).toBe(true);
    expect(paletteAvailable({ childView: true, familyOn: false })).toBe(false);
    expect(paletteAvailable({ childView: true, familyOn: true })).toBe(false);
    expect(paletteAvailable({ childView: false, familyOn: true })).toBe(false);
  });
});

describe("palette items", () => {
  it("lists new conversation, projects, 8 recent chats, files and settings", () => {
    const items = paletteItems(sources());
    expect(items[0]?.label).toBe("New conversation");
    expect(items.filter((item) => item.icon === "conversation")).toHaveLength(RECENT_LIMIT);
    expect(items.filter((item) => item.icon === "project")).toHaveLength(2);
    expect(items.map((item) => item.label)).toContain("Files in Garden game");
    expect(items.map((item) => item.label)).not.toContain("Files in Questions");
    expect(items.at(-1)?.label).toBe("Settings");
  });

  it("starts a conversation on the new screen at phone width", () => {
    expect(paletteItems(sources({ columns: 1 }))[0]?.run).toEqual({ kind: "go", href: "#/new" });
    expect(paletteItems(sources())[0]?.run).toEqual({ kind: "go", href: "#/" });
  });
});

describe("palette filtering", () => {
  it("matches any part of a label, ignoring case", () => {
    const items = paletteItems(sources());
    expect(filterItems(items, "GARDEN").map((item) => item.label)).toContain("Garden game");
    expect(filterItems(items, "chat 1").map((item) => item.label)).toEqual(["Chat 1"]);
    expect(filterItems(items, "zzz")).toEqual([]);
    expect(filterItems(items, "  ")).toHaveLength(items.length);
  });
});

describe("palette keys", () => {
  it("wraps the highlighted row at both ends", () => {
    expect(moveSelection(0, 3, 1)).toBe(1);
    expect(moveSelection(2, 3, 1)).toBe(0);
    expect(moveSelection(0, 3, -1)).toBe(2);
    expect(moveSelection(0, 0, 1)).toBe(0);
  });

  it("recognises Cmd+K / Ctrl+K only", () => {
    const base = { key: "k", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
    const mac = navigator.platform.toLowerCase().includes("mac");
    expect(isPaletteShortcut({ ...base, metaKey: mac, ctrlKey: !mac })).toBe(true);
    expect(isPaletteShortcut(base)).toBe(false);
    expect(isPaletteShortcut({ ...base, metaKey: mac, ctrlKey: !mac, shiftKey: true })).toBe(false);
    expect(isPaletteShortcut({ ...base, key: "f", metaKey: mac, ctrlKey: !mac })).toBe(false);
  });
});
