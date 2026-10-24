// Mounted once in the app shell: shows the one "SKYCOT has a new version ready" notification
// when the Mac app's updater says a downloaded version is ready. The rules live in
// ./readyNotice.ts; this file only wires them to the window, the Family profile, storage and
// the restart sheet. Renders nothing.
import { useEffect, useState } from "react";

import { PRODUCT_NAME } from "../../brand";
import { readPermission } from "../notifications/prefs";
import { createReadyNotifier, READY_NOTICE_KEY } from "./readyNotice";
import { openRestartSheet, useDesktopUpdateState } from "./store";
import { isChildSession } from "../../app/useChildView";

function readNoticed(): string | null {
  try {
    return window.localStorage.getItem(READY_NOTICE_KEY);
  } catch {
    return null;
  }
}

function writeNoticed(version: string) {
  try {
    window.localStorage.setItem(READY_NOTICE_KEY, version);
  } catch {
    // Blocked storage: the notifier still remembers it for this run.
  }
}

function windowInFront(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

function show(text: { readonly title: string; readonly body: string }, onClick: () => void) {
  try {
    const notification = new Notification(text.title, {
      body: text.body,
      tag: "skycot:update-ready",
      silent: true,
    });
    notification.addEventListener("click", () => {
      notification.close();
      onClick();
    });
    return true;
  } catch {
    // Some browsers expose Notification but refuse to show one.
    return false;
  }
}

function reveal() {
  window.focus();
  void window.desktopBridge?.revealWindow?.().catch(() => undefined);
}

export function ReadyNotifier() {
  const state = useDesktopUpdateState();
  const [notify] = useState(() =>
    createReadyNotifier({
      productName: PRODUCT_NAME,
      moment: () => ({
        windowInFront: windowInFront(),
        permission: readPermission(),
        childSession: isChildSession(),
      }),
      readNoticed,
      writeNoticed,
      show,
      reveal,
      openRestartSheet,
    }),
  );
  useEffect(() => notify(state), [notify, state]);
  return null;
}
