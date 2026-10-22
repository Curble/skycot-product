// Mounted once inside the Family provider: runs the limits clock while the profile is on, puts
// "Who's using SKYCOT?" up when the window opens with more than one child, and the asleep
// screen whenever the engine says SKYCOT is asleep for the child here. It also keeps this
// browser's look and text size in step with the child: the child's own look on switching, and
// a look the child picks in Appearance saved back to their profile.
import { deviceTimeZone } from "../../plain/daylight";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { readActiveThemeId, setActiveTheme, themeById, useActiveTheme } from "../../themes/store";
import { useTextSize, writeTextSize } from "../settings/localPrefs";
import { useFamily } from "../family/FamilyProvider";
import { currentChild } from "../family/family";
import { saveOwnLook } from "../family/store";
import { AsleepScreen } from "./AsleepScreen";
import { ChildPicker } from "./ChildPicker";
import { startLimitsClock, useLimits } from "./store";

const PICKED_KEY = "skycot:family:picked";

function pickedThisWindow(): boolean {
  try {
    return window.sessionStorage.getItem(PICKED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberPicked() {
  try {
    window.sessionStorage.setItem(PICKED_KEY, "1");
  } catch {
    // Blocked storage: the picker shows again on the next reload, which is harmless.
  }
}

const pickerListeners = new Set<() => void>();
let pickerRequested = false;

/** Opens "Who's using SKYCOT?" (Settings › Family › Switch). */
export function openChildPicker() {
  pickerRequested = true;
  for (const listener of pickerListeners) listener();
}

function closeRequestedPicker() {
  pickerRequested = false;
  for (const listener of pickerListeners) listener();
}

function usePickerRequested(): boolean {
  return useSyncExternalStore(
    (listener) => {
      pickerListeners.add(listener);
      return () => {
        pickerListeners.delete(listener);
      };
    },
    () => pickerRequested,
    () => false,
  );
}

// "Wakes up at 7 am tomorrow" only needs the minute.
const readMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
const subscribeMinute = (onChange: () => void) => {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
};

export function FamilyLimitsHost() {
  const family = useFamily();
  const view = family.profile;
  const { session } = useLimits();
  const requested = usePickerRequested();
  const [picked, setPicked] = useState(pickedThisWindow);
  const now = useSyncExternalStore(subscribeMinute, readMinute, readMinute);
  const engineKnown = view.source === "engine" && view.enabled;

  useEffect(() => {
    if (!engineKnown) return;
    return startLimitsClock();
  }, [engineKnown]);

  useChildLook(engineKnown ? currentChild(view) : null);

  if (!engineKnown) return null;
  const child = currentChild(view);
  const several = view.children.length > 1;
  if (requested || view.needsChoice || (several && !picked)) {
    return (
      <ChildPicker
        dismissible={requested && !view.needsChoice}
        onDone={() => {
          rememberPicked();
          setPicked(true);
          closeRequestedPicker();
        }}
      />
    );
  }
  const limits = session?.childId === child?.id ? session?.limits : null;
  if (child !== null && limits?.asleep) {
    return (
      <AsleepScreen
        child={child}
        state={limits}
        timeZone={view.timeZone ?? deviceTimeZone()}
        now={now}
        onSomeoneElse={several ? openChildPicker : null}
      />
    );
  }
  return null;
}

/**
 * The child's look follows them: on switching (or when a parent changes it), this browser takes
 * the child's look and text size; when the child picks another look here, it is saved to them.
 */
function useChildLook(
  child: { readonly id: string; readonly look: string; readonly largerText: boolean } | null,
) {
  const theme = useActiveTheme();
  const textSize = useTextSize();
  const seen = useRef<{
    id: string;
    look: string;
    largerText: boolean;
    theme: string;
    large: boolean;
  } | null>(null);
  useEffect(() => {
    if (child === null) {
      seen.current = null;
      return;
    }
    const large = textSize === "large";
    const before = seen.current;
    const childChanged =
      before === null ||
      before.id !== child.id ||
      before.look !== child.look ||
      before.largerText !== child.largerText;
    if (childChanged) {
      // The profile wins: apply it here, unless this browser does not have that look.
      if (themeById(child.look) !== null && readActiveThemeId() !== child.look)
        setActiveTheme(child.look);
      if (large !== child.largerText) writeTextSize(child.largerText ? "large" : "normal");
      seen.current = {
        id: child.id,
        look: child.look,
        largerText: child.largerText,
        theme: themeById(child.look) !== null ? child.look : theme.id,
        large: child.largerText,
      };
      return;
    }
    if (before.theme !== theme.id || before.large !== large) {
      seen.current = { ...before, theme: theme.id, large };
      void saveOwnLook({ look: theme.id, largerText: large });
    }
  }, [child, theme.id, textSize]);
}
