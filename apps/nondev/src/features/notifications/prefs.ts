// Settings › Notifications, kept by this browser (the OS asks per app or per site, so the
// switches belong to the device too). Each switch follows the profile until someone flips it:
// on for a Family profile (the grown-up's "needs a grown-up" ping is the point), off otherwise,
// because a grown-up turns them on after the browser's own question. The sound is always off
// until someone turns it on.
import { useEffect, useState } from "react";

import { useFamily } from "../family/FamilyProvider";
import { useNotifyChoice, writeNotifyChoice, type NotifyChoice } from "../settings/localPrefs";
import type { NotifyGroup } from "./decide";

export type NotifySwitch = NotifyGroup | "sound";

export interface NotifySettings {
  readonly finished: boolean;
  readonly needsOk: boolean;
  readonly failed: boolean;
  readonly sound: boolean;
}

export function notifySettingsFor(
  choices: Readonly<Record<NotifySwitch, NotifyChoice>>,
  family: boolean,
): NotifySettings {
  const pick = (choice: NotifyChoice, fallback: boolean) =>
    choice === null ? fallback : choice === "on";
  return {
    finished: pick(choices.finished, family),
    needsOk: pick(choices.needsOk, family),
    failed: pick(choices.failed, family),
    sound: pick(choices.sound, false),
  };
}

export function useNotifySettings(): NotifySettings {
  const family = useFamily();
  const choices = {
    finished: useNotifyChoice("finished"),
    needsOk: useNotifyChoice("needsOk"),
    failed: useNotifyChoice("failed"),
    sound: useNotifyChoice("sound"),
  };
  return notifySettingsFor(choices, family.enabled);
}

/** Stores a switch; the profile's default is stored as "unset" so it keeps following it. */
export function writeNotifySwitch(key: NotifySwitch, on: boolean, family: boolean) {
  const fallback = key === "sound" ? false : family;
  writeNotifyChoice(key, on === fallback ? null : on ? "on" : "off");
}

export type PermissionState = NotificationPermission | "unsupported";

export function readPermission(): PermissionState {
  if (typeof Notification === "undefined" || !window.isSecureContext) return "unsupported";
  return Notification.permission;
}

/**
 * The browser's answer, re-read when the window comes back (the person may have just changed
 * it in System Settings or the browser's site settings).
 */
export function usePermission(): readonly [PermissionState, (next: PermissionState) => void] {
  const [state, setState] = useState<PermissionState>(readPermission);
  useEffect(() => {
    const refresh = () => setState(readPermission());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return [state, setState];
}

/** Asks the browser (or the desktop app) once; only ever called from a button press. */
export async function askPermission(): Promise<PermissionState> {
  if (readPermission() === "unsupported") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return readPermission();
  }
}

/** Where the person turns notifications back on, in plain words for this device. */
export function deniedHelp(desktop: boolean): string {
  return desktop
    ? "Your Mac is blocking them. Open System Settings › Notifications › SKYCOT and turn on Allow notifications."
    : "This browser is blocking them. Click the icon left of the address bar, set Notifications to Allow, then come back here. Your Mac's System Settings › Notifications must also allow your browser.";
}
