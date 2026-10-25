import { describe, expect, it, vi } from "vite-plus/test";
import type { ServerFamilyStatus } from "./family";

const api = vi.hoisted(() => ({ status: vi.fn(), lock: vi.fn() }));
vi.mock("./api", () => ({ familyApi: api }));

import { lockFamilyGrants, readFamilyView, refreshFamily } from "./store";

const status: ServerFamilyStatus = {
  enabled: true,
  childName: null,
  createdAt: null,
  attemptsLeft: 5,
  lockedForMs: 0,
  children: [],
  timeZone: null,
};

describe("ending grown-up mode", () => {
  it("refreshes after a lock response that omits grants so the bar closes immediately", async () => {
    api.status.mockResolvedValueOnce({
      ok: true,
      value: {
        ...status,
        grants: [{ purpose: "settings", remainingMs: 600_000 }],
      },
    });
    await refreshFamily();
    expect(readFamilyView().openUntil.settings).toBeDefined();
    api.lock.mockResolvedValueOnce({ ok: true, value: status });
    api.status.mockResolvedValueOnce({ ok: true, value: { ...status, grants: [] } });
    await lockFamilyGrants();
    expect(readFamilyView().openUntil).toEqual({});
    expect(api.status).toHaveBeenCalledTimes(2);
  });
});
