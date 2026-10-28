import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/environments/primary/target", () => ({
  resolvePrimaryEnvironmentHttpUrl: (pathname: string) => `http://127.0.0.1:47391${pathname}`,
}));
vi.mock("~/environments/primary/desktopAuth", () => ({
  readDesktopPrimaryBearerToken: async () => "token",
}));

import { callEngine } from "./api";
import { forgetUnlockProof, keepUnlockProof, readUnlockProof } from "./unlockProof";

const ENGINE = "http://127.0.0.1:47391";
const HEADER = "x-skycot-family-unlock";

describe("the grown-up proof in memory", () => {
  it("keeps a real token, ignores empty or missing ones, and forgets on demand", () => {
    try {
      expect(readUnlockProof()).toBeNull();
      keepUnlockProof(undefined);
      keepUnlockProof(null);
      keepUnlockProof("");
      expect(readUnlockProof()).toBeNull();
      keepUnlockProof("fixture-proof");
      expect(readUnlockProof()).toBe("fixture-proof");
      // A later empty answer does not wipe a good proof.
      keepUnlockProof("");
      expect(readUnlockProof()).toBe("fixture-proof");
      forgetUnlockProof();
      expect(readUnlockProof()).toBeNull();
    } finally {
      forgetUnlockProof();
    }
  });
});

describe("sending the grown-up proof", () => {
  it("goes only to the engine's address, on every call", async () => {
    vi.stubGlobal("window", { location: { origin: "skycot://app" }, desktopBridge: {} });
    const seen: Array<{ url: string; proof: string | null }> = [];
    using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      seen.push({ url: String(input), proof: new Headers(init?.headers).get(HEADER) });
      return new Response("{}", { status: 200 });
    });
    try {
      keepUnlockProof("fixture-proof");
      await callEngine("POST", "/api/skycot/family/renew", {});
      await callEngine("POST", "/api/skycot/family/approve-session", { requestId: "r" });
      await callEngine("GET", "/api/skycot/updates", undefined);
      expect(seen).toHaveLength(3);
      for (const call of seen) {
        expect(call.url.startsWith(`${ENGINE}/`)).toBe(true);
        expect(call.proof).toBe("fixture-proof");
      }
    } finally {
      forgetUnlockProof();
      vi.unstubAllGlobals();
    }
  });

  it("sends nothing before a proof exists", async () => {
    vi.stubGlobal("window", { location: { origin: "skycot://app" }, desktopBridge: {} });
    let proof: string | null = "unset";
    using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      proof = new Headers(init?.headers).get(HEADER);
      return new Response("{}", { status: 200 });
    });
    try {
      forgetUnlockProof();
      await callEngine("POST", "/api/skycot/family/renew", {});
      expect(proof).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("is never written to cookies or browser storage", async () => {
    const cookieWrites: string[] = [];
    const stored: string[] = [];
    const storage = { setItem: (_key: string, value: string) => stored.push(value) };
    vi.stubGlobal("window", {
      location: { origin: "skycot://app" },
      desktopBridge: {},
      localStorage: storage,
      sessionStorage: storage,
    });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("document", {
      set cookie(value: string) {
        cookieWrites.push(value);
      },
      get cookie() {
        return "";
      },
    });
    using _fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("{}", { status: 200 }));
    try {
      keepUnlockProof("fixture-proof");
      await callEngine("POST", "/api/skycot/family/prepare-update", {});
      expect(cookieWrites).toEqual([]);
      expect(stored.filter((value) => value.includes("fixture-proof"))).toEqual([]);
    } finally {
      forgetUnlockProof();
      vi.unstubAllGlobals();
    }
  });
});
