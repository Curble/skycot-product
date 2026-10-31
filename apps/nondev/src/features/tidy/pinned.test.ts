import { describe, expect, it } from "vite-plus/test";

import { comparePinned, isPinned, pinMenuLabel, pinToastMessage, splitPinned } from "./pinned";

const row = (id: string, pinnedAt: string | null = null, pinOrderKey: string | null = null) => ({
  id,
  shell: { pinnedAt, pinOrderKey },
});

describe("pinMenuLabel", () => {
  it("offers Pin to top on a loose conversation and Unpin on a pinned one", () => {
    expect(pinMenuLabel({ pinnedAt: null, pinOrderKey: null })).toBe("Pin to top");
    expect(pinMenuLabel({})).toBe("Pin to top");
    expect(pinMenuLabel({ pinnedAt: "2026-11-01T00:00:00.000Z", pinOrderKey: null })).toBe("Unpin");
    expect(isPinned({ pinnedAt: "2026-11-01T00:00:00.000Z" })).toBe(true);
  });

  it("uses plain toast words", () => {
    expect(pinToastMessage(true)).toBe("Pinned to the top");
    expect(pinToastMessage(false)).toBe("Unpinned");
  });
});

describe("splitPinned", () => {
  it("puts pinned first, newest pin first, and leaves the rest in order", () => {
    const rows = [
      row("a"),
      row("b", "2026-10-01T00:00:00.000Z"),
      row("c"),
      row("d", "2026-10-05T00:00:00.000Z"),
    ];
    const { pinned, rest } = splitPinned(rows);
    expect(pinned.map((r) => r.id)).toEqual(["d", "b"]);
    expect(rest.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("follows the engine's order key when there is one", () => {
    const rows = [
      row("late", "2026-10-09T00:00:00.000Z", "m"),
      row("first", "2026-10-01T00:00:00.000Z", "c"),
      row("keyless", "2026-10-10T00:00:00.000Z"),
    ];
    expect(splitPinned(rows).pinned.map((r) => r.id)).toEqual(["first", "late", "keyless"]);
    expect(comparePinned(rows[0]!.shell, rows[1]!.shell)).toBeGreaterThan(0);
  });

  it("never adds or drops a row", () => {
    const rows = [row("a"), row("b", "2026-10-01T00:00:00.000Z")];
    const { pinned, rest } = splitPinned(rows);
    expect(pinned.length + rest.length).toBe(rows.length);
  });
});
