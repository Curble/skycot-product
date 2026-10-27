// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  listener: null as null | ((purpose: string) => void),
  fetchRecap: vi.fn(),
  currentChildId: "ava" as string | null,
}));

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => ["environment"] }));
vi.mock("../../state/catalog", () => ({ enabledEnvironmentIdsAtom: "ids" }));
vi.mock("../../router", () => ({ navigate: vi.fn(), recapHref: () => "/recap" }));
vi.mock("../brand/Mascot", () => ({ Mascot: () => null }));
vi.mock("./RecapReportView", () => ({ RecapReportView: () => <p>report body</p> }));
vi.mock("../../ui/Sheet", () => ({
  Sheet: (props: { title: string; children: unknown; actions: unknown }) => (
    <section>
      <h1>{props.title}</h1>
      {props.children as never}
      {props.actions as never}
    </section>
  ),
}));
vi.mock("../family/FamilyProvider", () => ({
  useFamily: () => ({
    profile: {
      currentChildId: fixture.currentChildId,
      children: [{ id: "ava", name: "Ava" }],
    },
  }),
}));
vi.mock("../family/store", () => ({
  onParentYes: (listener: (purpose: string) => void) => {
    fixture.listener = listener;
    return () => {
      fixture.listener = null;
    };
  },
}));
vi.mock("./api", () => ({ fetchRecap: fixture.fetchRecap }));

import { SessionRecapHost } from "./SessionRecap";

const report = (endedAgo: number) => ({
  childId: "ava",
  range: "last-session",
  from: 0,
  to: 1,
  timeZone: "Australia/Melbourne",
  days: [],
  minutes: 20,
  messages: 2,
  made: [],
  asks: [],
  grownUp: { held: 0, approved: 0, moreTime: [], shield: {}, shieldAllowed: 0 },
  proudOf: null,
  session: {
    id: "ava-1",
    startedAt: Date.now() - endedAgo - 20 * 60_000,
    endedAt: Date.now() - endedAgo,
  },
});

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  fixture.currentChildId = "ava";
  fixture.fetchRecap.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const parentSaysYes = async (purpose = "settings") => {
  await act(async () => {
    fixture.listener?.(purpose);
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("the grown-up's last-session recap card", () => {
  it("shows once after the parent code, and Got it keeps it away for that session", async () => {
    fixture.fetchRecap.mockResolvedValue({ ok: true, value: report(10 * 60_000) });
    act(() => root.render(<SessionRecapHost />));
    expect(host.textContent).toBe("");
    await parentSaysYes();
    expect(host.textContent).toContain("Ava was planning something last time");
    expect(fixture.fetchRecap).toHaveBeenCalledWith("ava", "last-session");
    const gotIt = [...host.querySelectorAll("button")].find((b) => b.textContent === "Got it");
    act(() => gotIt!.click());
    expect(host.textContent).toBe("");
    await parentSaysYes();
    expect(host.textContent).toBe("");
  });

  it("shows seconds after the child stopped (the parent just took over), not for other codes", async () => {
    fixture.fetchRecap.mockResolvedValue({ ok: true, value: report(60_000) });
    act(() => root.render(<SessionRecapHost />));
    await parentSaysYes();
    expect(host.textContent).toContain("Ava was planning something last time");
    const gotIt = [...host.querySelectorAll("button")].find((b) => b.textContent === "Got it");
    act(() => gotIt!.click());
    await parentSaysYes("approve");
    expect(fixture.fetchRecap).toHaveBeenCalledTimes(1);
  });

  it("asks the engine for nothing without a parent code (a child's view never fetches)", async () => {
    act(() => root.render(<SessionRecapHost />));
    expect(fixture.fetchRecap).not.toHaveBeenCalled();
    expect(host.textContent).toBe("");
  });

  it("shows nothing when the engine refuses", async () => {
    fixture.fetchRecap.mockResolvedValue({ ok: false, reason: "forbidden", message: "no" });
    act(() => root.render(<SessionRecapHost />));
    await parentSaysYes();
    expect(host.textContent).toBe("");
  });
});
