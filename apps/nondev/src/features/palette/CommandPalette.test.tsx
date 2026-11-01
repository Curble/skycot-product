// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({ childView: false, familyOn: false }));

vi.mock("../../app/useChildView", () => ({ useChildView: () => fixture.childView }));
vi.mock("../family/FamilyProvider", () => ({ useFamily: () => ({ enabled: fixture.familyOn }) }));
vi.mock("../../app/ShellState", () => ({ useShellState: () => ({ setProjectKey: vi.fn() }) }));
vi.mock("../../app/useColumns", () => ({ useColumns: () => 3 }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => [] }));
vi.mock("../../state/conversations", () => ({
  conversationRowsAtom: {},
  projectKeyOf: (ref: { environmentId: string; projectId: string }) =>
    `${ref.environmentId}:${ref.projectId}`,
}));
vi.mock("../../state/projects", () => ({ environmentProjects: { projectsAtom: {} } }));

import { CommandPaletteHost } from "./CommandPalette";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<() => void> = [];
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  document.body.innerHTML = "";
});

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<CommandPaletteHost />));
  mounted.push(() => act(() => root.unmount()));
}

function pressK() {
  const mac = navigator.platform.toLowerCase().includes("mac");
  const event = new KeyboardEvent("keydown", {
    key: "k",
    metaKey: mac,
    ctrlKey: !mac,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe("command palette host", () => {
  it("opens on the shortcut for a grown-up, and Escape closes it", () => {
    mount();
    expect(pressK().defaultPrevented).toBe(true);
    expect(document.querySelector(".fm-palette")).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector(".fm-palette")).toBeNull();
  });

  it("is inert on a child's device", () => {
    fixture.childView = true;
    fixture.familyOn = true;
    mount();
    const event = pressK();
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector(".fm-palette")).toBeNull();
    fixture.childView = false;
    fixture.familyOn = false;
  });

  it("is inert for a grown-up while the Family profile is on", () => {
    fixture.familyOn = true;
    mount();
    const event = pressK();
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector(".fm-palette")).toBeNull();
    fixture.familyOn = false;
  });
});
