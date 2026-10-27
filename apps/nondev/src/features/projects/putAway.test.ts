import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const store = vi.hoisted(() => ({
  putAwayProject: vi.fn(),
  bringBackProject: vi.fn(),
}));
const toast = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("../family/store", () => store);
vi.mock("../../ui/Toast", () => toast);

import { PUT_AWAY_UNDO_MS, putProjectAway } from "./putAway";

afterEach(() => vi.clearAllMocks());

describe("a child putting a project away", () => {
  it("shows a ten-second Undo that asks the engine to bring it back", async () => {
    store.putAwayProject.mockResolvedValue({ ok: true });
    store.bringBackProject.mockResolvedValue({ ok: true });
    expect(await putProjectAway({ id: "p1", title: "Dinos" })).toBe(true);
    const [message, action, ms] = toast.showToast.mock.calls[0]!;
    expect(message).toBe("Put Dinos away");
    expect(ms).toBe(PUT_AWAY_UNDO_MS);
    expect(PUT_AWAY_UNDO_MS).toBe(10_000);
    await action.run();
    expect(store.bringBackProject).toHaveBeenCalledWith("p1");
    expect(toast.showToast).toHaveBeenCalledTimes(1);
  });

  it("says so when the Undo is too late, and when it isn't theirs", async () => {
    store.putAwayProject.mockResolvedValue({ ok: true });
    store.bringBackProject.mockResolvedValue({ ok: false, reason: "forbidden", message: "x" });
    await putProjectAway({ id: "p1", title: "Dinos" });
    await toast.showToast.mock.calls[0]![1].run();
    expect(toast.showToast.mock.calls[1]![0]).toBe(
      "That's put away. A grown-up can bring it back.",
    );

    toast.showToast.mockClear();
    store.putAwayProject.mockResolvedValue({
      ok: false,
      reason: "forbidden",
      message: "That's not yours to open.",
    });
    expect(await putProjectAway({ id: "p2", title: "Bea's" })).toBe(false);
    expect(toast.showToast).toHaveBeenCalledWith("That's not yours to open.");
  });
});
