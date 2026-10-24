import type { DesktopUpdateState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { EMPTY_VIEW, type FamilyView } from "../family/family";
import {
  childSessionFor,
  createReadyNotifier,
  readyNoticeText,
  shouldShowReadyNotice,
  type ReadyNoticeMoment,
} from "./readyNotice";

const base: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "0.0.42",
  hostArch: "arm64",
  appArch: "arm64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};
const downloading = (version: string): DesktopUpdateState => ({
  ...base,
  status: "downloading",
  availableVersion: version,
  downloadPercent: 50,
});
const ready = (version: string): DesktopUpdateState => ({
  ...base,
  status: "downloaded",
  availableVersion: version,
  downloadedVersion: version,
});

const BACK: ReadyNoticeMoment = {
  windowInFront: false,
  permission: "granted",
  childSession: false,
};

function harness(
  options: {
    moment?: ReadyNoticeMoment;
    stored?: string | null;
    storageBlocked?: boolean;
  } = {},
) {
  let moment = options.moment ?? BACK;
  let stored = options.stored ?? null;
  const shown: Array<{ title: string; body: string; click: () => void }> = [];
  const calls: string[] = [];
  const notify = createReadyNotifier({
    productName: "SKYCOT",
    moment: () => moment,
    readNoticed: () => (options.storageBlocked ? null : stored),
    writeNoticed: (version) => {
      if (!options.storageBlocked) stored = version;
    },
    show: (text, onClick) => {
      shown.push({ ...text, click: onClick });
      return true;
    },
    reveal: () => calls.push("reveal"),
    openRestartSheet: () => calls.push("open-sheet"),
  });
  return {
    notify,
    shown,
    calls,
    stored: () => stored,
    setMoment: (next: ReadyNoticeMoment) => {
      moment = next;
    },
  };
}

describe("the new-version-ready notification", () => {
  it("says it plainly, with the product's name", () => {
    expect(readyNoticeText("SKYCOT")).toEqual({
      title: "SKYCOT has a new version ready",
      body: "Restart when it suits you.",
    });
  });

  it("shows once when a version becomes ready and the window is at the back", () => {
    const h = harness();
    h.notify(null);
    h.notify(downloading("0.0.43"));
    expect(h.shown).toHaveLength(0);
    h.notify(ready("0.0.43"));
    expect(h.shown.map((entry) => entry.title)).toEqual(["SKYCOT has a new version ready"]);
    expect(h.stored()).toBe("0.0.43");
    // The updater keeps sending the same state every few minutes: still one.
    h.notify(ready("0.0.43"));
    h.notify({ ...ready("0.0.43"), checkedAt: "2026-10-24T10:00:00Z" });
    expect(h.shown).toHaveLength(1);
  });

  it("never shows twice for a version, even after a restart of SKYCOT", () => {
    const h = harness({ stored: "0.0.43" });
    h.notify(ready("0.0.43"));
    expect(h.shown).toHaveLength(0);
    // A newer version is news again.
    h.notify(ready("0.0.44"));
    expect(h.shown).toHaveLength(1);
  });

  it("with storage blocked, shows at most once in this run", () => {
    const h = harness({ storageBlocked: true });
    h.notify(ready("0.0.43"));
    h.notify(downloading("0.0.43"));
    h.notify(ready("0.0.43"));
    expect(h.shown).toHaveLength(1);
  });

  it("stays quiet while the window is in front, and does not catch up when it goes back", () => {
    const h = harness({ moment: { ...BACK, windowInFront: true } });
    h.notify(ready("0.0.43"));
    expect(h.shown).toHaveLength(0);
    h.setMoment(BACK);
    h.notify(ready("0.0.43"));
    h.notify(downloading("0.0.43"));
    h.notify(ready("0.0.43"));
    expect(h.shown).toHaveLength(0);
  });

  it("stays quiet during a child's session", () => {
    const h = harness({ moment: { ...BACK, childSession: true } });
    h.notify(ready("0.0.43"));
    expect(h.shown).toHaveLength(0);
  });

  it("stays quiet when notifications are not allowed, and never asks", () => {
    for (const permission of ["denied", "default", "unsupported"] as const) {
      const h = harness({ moment: { ...BACK, permission } });
      h.notify(ready("0.0.43"));
      expect(h.shown).toHaveLength(0);
    }
    expect(shouldShowReadyNotice(BACK)).toBe(true);
  });

  it("clicking it brings SKYCOT forward and opens the restart sheet, never a restart", () => {
    const h = harness();
    h.notify(ready("0.0.43"));
    expect(h.calls).toEqual([]);
    h.shown[0]!.click();
    expect(h.calls).toEqual(["reveal", "open-sheet"]);
  });

  it("an install error after the download still counts as the same ready version", () => {
    const h = harness();
    h.notify(ready("0.0.43"));
    h.notify({ ...ready("0.0.43"), status: "error", errorContext: "install" });
    expect(h.shown).toHaveLength(1);
  });
});

describe("who counts as a child's session", () => {
  const view = (patch: Partial<FamilyView>): FamilyView => ({ ...EMPTY_VIEW, ...patch });
  const none = { pickerOpen: false, asleep: false };
  const child = {
    id: "c1",
    name: "Ada",
  } as unknown as FamilyView["children"][number];

  it("no Family profile: never", () => {
    expect(childSessionFor(view({}), none)).toBe(false);
    expect(childSessionFor(view({}), { pickerOpen: true, asleep: true })).toBe(false);
  });

  it("Family profile with no child here yet: a grown-up's moment", () => {
    expect(childSessionFor(view({ enabled: true }), none)).toBe(false);
  });

  it("Family profile with a child here, the picker up, asleep, or a child's own device", () => {
    expect(
      childSessionFor(view({ enabled: true, children: [child], currentChildId: "c1" }), none),
    ).toBe(true);
    expect(childSessionFor(view({ enabled: true, needsChoice: true }), none)).toBe(true);
    expect(childSessionFor(view({ enabled: true }), { pickerOpen: true, asleep: false })).toBe(
      true,
    );
    expect(childSessionFor(view({ enabled: true }), { pickerOpen: false, asleep: true })).toBe(
      true,
    );
    expect(
      childSessionFor(
        view({
          enabled: true,
          me: { kind: "child", deviceId: "d", deviceName: "iPad", childId: "c1" },
        }),
        none,
      ),
    ).toBe(true);
    expect(childSessionFor(view({ legacy: true, childName: "Ada" }), none)).toBe(true);
  });
});
