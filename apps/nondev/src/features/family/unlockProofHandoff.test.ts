import { afterEach, describe, expect, it } from "vite-plus/test";

import { startFreshWindow } from "../family-limits/store";
import {
  UNLOCK_HANDOFF_KEY,
  clearUnlockProofHandoff,
  forgetUnlockProof,
  handoffUnlockProof,
  keepUnlockProof,
  readUnlockProof,
  restoreUnlockProofOnBoot,
  takeUnlockProofHandoff,
} from "./unlockProof";

function memory() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

afterEach(() => forgetUnlockProof());

describe("unlock proof hand-over across the restart", () => {
  it("writes nothing without a proof", () => {
    const s = memory();
    expect(handoffUnlockProof(s)).toBe(false);
    expect(s.map.size).toBe(0);
  });

  it("writes, takes once, and deletes", () => {
    const s = memory();
    keepUnlockProof("tok");
    expect(handoffUnlockProof(s)).toBe(true);
    expect(takeUnlockProofHandoff(s)).toBe("tok");
    expect(s.map.has(UNLOCK_HANDOFF_KEY)).toBe(false);
    expect(takeUnlockProofHandoff(s)).toBeNull();
  });

  it("boot restores it only while the grown-up mark is set, and always deletes the slot", () => {
    const a = memory();
    a.setItem(UNLOCK_HANDOFF_KEY, "tok");
    restoreUnlockProofOnBoot("person-1", a);
    expect(readUnlockProof()).toBe("tok");
    expect(a.map.size).toBe(0);
    forgetUnlockProof();
    const b = memory();
    b.setItem(UNLOCK_HANDOFF_KEY, "tok");
    restoreUnlockProofOnBoot(null, b);
    expect(readUnlockProof()).toBeNull();
    expect(b.map.size).toBe(0);
  });

  it("clearing removes the slot", () => {
    const s = memory();
    s.setItem(UNLOCK_HANDOFF_KEY, "tok");
    clearUnlockProofHandoff(s);
    expect(s.map.size).toBe(0);
  });

  it("forgetUnlockProof (used by end session and lock) clears the window's slot", () => {
    const store = memory();
    const original = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { sessionStorage: store };
    try {
      store.setItem(UNLOCK_HANDOFF_KEY, "tok");
      forgetUnlockProof();
      expect(store.map.size).toBe(0);
    } finally {
      (globalThis as { window?: unknown }).window = original;
    }
  });

  it("startFreshWindow parks the proof only when one exists", () => {
    const win = { location: { hash: "", reload: () => {} } };
    const parked: Array<string | null> = [];
    const park = () => parked.push(readUnlockProof());
    startFreshWindow(win, () => {}, null, park);
    keepUnlockProof("tok");
    startFreshWindow(win, () => {}, null, park);
    expect(parked).toEqual([null, "tok"]);
    const s = memory();
    forgetUnlockProof();
    handoffUnlockProof(s);
    expect(s.map.size).toBe(0);
    keepUnlockProof("tok");
    handoffUnlockProof(s);
    expect(s.map.get(UNLOCK_HANDOFF_KEY)).toBe("tok");
  });
});
