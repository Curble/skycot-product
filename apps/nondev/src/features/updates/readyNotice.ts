// One ordinary Mac notification when a new version has downloaded and is ready: "SKYCOT has a
// new version ready". Local only (the web Notification API, which the Mac app shows in
// Notification Centre): no server, no push. The title-bar pill stays the main signal; this is
// for someone who is not looking at SKYCOT at that moment.
//
// The rules, decided once per version at the moment it becomes ready:
//   - at most once per version, ever (remembered on this Mac; once per run if storage is blocked);
//   - only when the SKYCOT window is not in front (someone looking at it sees the pill);
//   - never while a child is using SKYCOT (Family profile), nor while "Who's using SKYCOT?" or
//     the asleep screen is up: a grown-up sees the pill instead;
//   - only when notifications are already allowed: SKYCOT never asks for this one.
// Clicking it brings SKYCOT to the front and opens "Restart to update"; it never restarts.
//
// Pure apart from the deps passed in, so the rules are unit-tested (readyNotice.test.ts).
import type { DesktopUpdateState } from "@t3tools/contracts";

import type { FamilyView } from "../family/family";
import { readyVersion } from "./updates";

export const READY_NOTICE_KEY = "skycot:updates:ready-noticed";

export function readyNoticeText(productName: string): {
  readonly title: string;
  readonly body: string;
} {
  return { title: `${productName} has a new version ready`, body: "Restart when it suits you." };
}

/**
 * A child's session, for this notice: the Family profile is on and a child is (or is about to
 * be) the person here. On the family's Mac with the profile on and any child, that is always.
 */
export function childSessionFor(
  view: Pick<
    FamilyView,
    "enabled" | "legacy" | "me" | "currentChildId" | "needsChoice" | "childName"
  >,
  extras: { readonly pickerOpen: boolean; readonly asleep: boolean },
): boolean {
  if (!view.enabled && !view.legacy) return false;
  return (
    view.me.kind === "child" ||
    view.currentChildId !== null ||
    view.needsChoice ||
    view.childName !== null ||
    extras.pickerOpen ||
    extras.asleep
  );
}

export interface ReadyNoticeMoment {
  readonly windowInFront: boolean;
  readonly permission: NotificationPermission | "unsupported";
  readonly childSession: boolean;
}

/** Whether to show the notice for this moment (the "once per version" part is the notifier's). */
export function shouldShowReadyNotice(moment: ReadyNoticeMoment): boolean {
  return !moment.windowInFront && moment.permission === "granted" && !moment.childSession;
}

export interface ReadyNoticeDeps {
  readonly productName: string;
  readonly moment: () => ReadyNoticeMoment;
  /** The version last decided on, from storage; null when none or storage is blocked. */
  readonly readNoticed: () => string | null;
  readonly writeNoticed: (version: string) => void;
  /** Shows the notification; false when the system refused to make one. */
  readonly show: (
    text: { readonly title: string; readonly body: string },
    onClick: () => void,
  ) => boolean;
  /** Brings the SKYCOT window to the front. */
  readonly reveal: () => void;
  readonly openRestartSheet: () => void;
}

/**
 * Watches the updater's state and decides once for each version, at the first moment it is
 * seen ready. A version that became ready while the window was in front (or during a child's
 * session) is still "decided": going to the back later does not bring the notice.
 */
export function createReadyNotifier(
  deps: ReadyNoticeDeps,
): (state: DesktopUpdateState | null) => void {
  /** Versions decided in this run: the fallback when storage is blocked. */
  const decided = new Set<string>();
  let lastReady: string | null = null;

  return (state) => {
    const version = readyVersion(state);
    const becameReady = version !== null && version !== lastReady;
    lastReady = version;
    if (!becameReady) return;
    if (decided.has(version) || deps.readNoticed() === version) return;
    decided.add(version);
    deps.writeNoticed(version);
    if (!shouldShowReadyNotice(deps.moment())) return;
    deps.show(readyNoticeText(deps.productName), () => {
      deps.reveal();
      deps.openRestartSheet();
    });
  };
}
