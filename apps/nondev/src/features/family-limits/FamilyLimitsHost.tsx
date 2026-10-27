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
import { readFamilyView, saveOwnLook } from "../family/store";
import { SessionRecapHost } from "../recap/SessionRecap";
import { AsleepScreen } from "./AsleepScreen";
import { asleepLimitsFor } from "./asleepGate";
import { ChildPicker } from "./ChildPicker";
import {
  endGrownUpSession,
  grownUpSessionFor,
  grownUpSessionStep,
  useGrownUpSessionId,
} from "../family/grownUpSession";
import {
  forgetRememberedChild,
  canReuseCurrentChild,
  freshTabChildAction,
  pickerAfterIdle,
  PICKER_IDLE_MS,
  rememberedChild,
  rememberChild,
  shouldShowChildPicker,
} from "./idlePicker";
import { chooseChild, heartbeat, startLimitsClock, useLimits } from "./store";

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

/**
 * The grown-up who just turned the Family profile on in first-run setup is the one using this
 * window: "Who's using SKYCOT?" waits until they finish (Done in the grown-up bar brings it).
 */
export function markPickedThisWindow() {
  rememberPicked();
  window.dispatchEvent(new Event("skycot:family-picked"));
}

const pickerListeners = new Set<() => void>();
let pickerRequested = false;

/** Opens "Who's using SKYCOT?" (Settings › Family › Switch). */
export function openChildPicker() {
  pickerRequested = true;
  for (const listener of pickerListeners) listener();
}

/** Whether "Who's using SKYCOT?" was asked for and is still up (read outside React). */
export function childPickerRequested(): boolean {
  return pickerRequested;
}

function closeRequestedPicker() {
  pickerRequested = false;
  for (const listener of pickerListeners) listener();
  window.dispatchEvent(new Event("skycot:child-picker-closed"));
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
  useEffect(() => {
    const onPicked = () => setPicked(true);
    window.addEventListener("skycot:family-picked", onPicked);
    return () => window.removeEventListener("skycot:family-picked", onPicked);
  }, []);
  const now = useSyncExternalStore(subscribeMinute, readMinute, readMinute);
  const engineKnown = view.source === "engine" && view.enabled;
  const restoreAttempted = useRef(false);
  // A grown-up's time on the shared Mac ended; the current child screen stays in place.
  const grownUpId = useGrownUpSessionId();
  const grownUpActive = grownUpSessionFor(grownUpId, view, now) !== null;
  useEffect(() => {
    if (
      !engineKnown ||
      session === null ||
      view.me.kind !== "shared" ||
      view.children.length === 0 ||
      restoreAttempted.current
    ) {
      return;
    }
    restoreAttempted.current = true;
    const asleep = session?.limits?.asleep === true;
    if (asleep) forgetRememberedChild();
    if (asleep) return;
    const savedId = rememberedChild(Date.now());
    const saved = view.children.find((entry) => entry.id === savedId);
    const inheritedChildIsRecent = canReuseCurrentChild({
      childCount: view.children.length,
      currentChildId: view.currentChildId,
      rememberedChildId: saved?.id ?? null,
    });
    const action = freshTabChildAction({
      childCount: view.children.length,
      currentChildId: view.currentChildId,
      needsChoice: view.needsChoice,
      rememberedChildId: saved?.id ?? null,
    });
    const restore = action === "restore" ? (saved ?? view.children[0]) : undefined;
    if (restore) {
      void chooseChild(restore.id).then((result) => {
        if (result.ok) {
          rememberChild(restore.id, Date.now());
          rememberPicked();
          setPicked(true);
        }
      });
    } else if (action === "reuse" && (inheritedChildIsRecent || view.children.length === 1)) {
      // A fresh tab may inherit the Mac's selected child, while its session storage is empty.
      rememberPicked();
      setPicked(true);
    } else if (view.children.length > 1) {
      // The engine can still have yesterday's child selected when this tab has no fresh choice.
      openChildPicker();
    }
  }, [engineKnown, session, view.children, view.me.kind, view.needsChoice]);
  // Only a change from open to closed ends it (see grownUpSessionStep).
  const wasActive = useRef(false);
  useEffect(() => {
    const step = grownUpSessionStep(wasActive.current, grownUpId, grownUpActive);
    wasActive.current = step.sawOpen;
    if (step.end) endGrownUpSession();
  }, [grownUpId, grownUpActive]);

  useEffect(() => {
    if (!engineKnown || view.me.kind !== "shared" || view.children.length < 2) return;
    let lastInputAt = Date.now();
    let timer: number | null = null;
    const checkIdle = () => {
      if (!pickerAfterIdle(lastInputAt, Date.now())) return;
      const current = readFamilyView();
      const grantUntil = Math.max(
        current.openUntil.grownUpSession ?? 0,
        current.openUntil.settings ?? 0,
        current.openUntil.advanced ?? 0,
      );
      const waitForGrant = grantUntil - Date.now();
      if (waitForGrant > 0) {
        timer = window.setTimeout(checkIdle, waitForGrant + 50);
        return;
      }
      openChildPicker();
    };
    const arm = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if (childPickerRequested()) return;
      const delay = Math.max(0, PICKER_IDLE_MS - (Date.now() - lastInputAt));
      timer = window.setTimeout(checkIdle, delay);
    };
    const onInput = () => {
      lastInputAt = Date.now();
      arm();
    };
    const onPickerClosed = () => {
      lastInputAt = Date.now();
      arm();
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const event of events) window.addEventListener(event, onInput, { passive: true });
    window.addEventListener("skycot:child-picker-closed", onPickerClosed);
    arm();
    return () => {
      for (const event of events) window.removeEventListener(event, onInput);
      window.removeEventListener("skycot:child-picker-closed", onPickerClosed);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [engineKnown, view.children.length, view.me.kind]);

  // The engine's word about the child here can be one beat old: ask again as soon as a grown-up's
  // turn opens or closes, or the child here changes, instead of waiting for the next heartbeat.
  const recheckKey = `${grownUpActive}|${view.currentChildId ?? ""}`;
  const lastRecheck = useRef(recheckKey);
  useEffect(() => {
    if (lastRecheck.current === recheckKey) return;
    lastRecheck.current = recheckKey;
    if (engineKnown) void heartbeat();
  }, [engineKnown, recheckKey]);

  useEffect(() => {
    if (!engineKnown) return;
    return startLimitsClock();
  }, [engineKnown]);

  useChildLook(engineKnown ? currentChild(view) : null);

  if (!engineKnown) return null;
  return (
    <>
      <LimitsCover
        now={now}
        requested={requested}
        picked={picked}
        setPicked={setPicked}
        grownUpActive={grownUpActive}
      />
      <SessionRecapHost />
    </>
  );
}

function LimitsCover({
  now,
  requested,
  picked,
  setPicked,
  grownUpActive,
}: {
  readonly grownUpActive: boolean;
  readonly now: number;
  readonly requested: boolean;
  readonly picked: boolean;
  readonly setPicked: (picked: boolean) => void;
}) {
  const view = useFamily().profile;
  const { session } = useLimits();
  const child = currentChild(view);
  // Everyone in the family picks their own picture: children, and grown-ups (with the code).
  // Only the family's Mac asks "Who's using SKYCOT?": a child's own device is always that
  // child, and a grown-up's device is nobody's child (the engine says which, never this tab).
  const shared = view.me.kind === "shared";
  // A grown-up using the Mac (after their code) is not asked again until Switch or Done.
  if (
    shouldShowChildPicker({
      shared,
      requested,
      childCount: view.children.length,
      grownUpActive,
      needsChoice: view.needsChoice,
      picked,
    })
  ) {
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
  const limits = asleepLimitsFor({ childId: child?.id ?? null, session, grownUpActive });
  if (child !== null && limits !== null) {
    return (
      <AsleepScreen
        child={child}
        state={limits}
        timeZone={view.timeZone ?? deviceTimeZone()}
        now={now}
        onSomeoneElse={view.children.length > 1 && shared ? openChildPicker : null}
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
