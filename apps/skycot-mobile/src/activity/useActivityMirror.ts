/**
 * Keeps the Live Activity and the widget in step with what the app last saw, while it is open.
 * Starting, updating and ending happen here, on the device; nothing is pushed from outside
 * until SKYCOT Relay sends Apple's push (Phase 2), so a closed app leaves the last words up
 * until their stale time, when the activity says "Open SKYCOT to see what's new".
 */
import { requireOptionalNativeModule } from "expo";
import { useEffect, useRef } from "react";

import { useOptionalChild } from "../app/child/ChildContext";
import { conversationRows } from "../data/conversations";
import { useMacData } from "../data/MacData";
import { useLinks } from "../links/store";
import { BUILDER_NAME } from "../ui/brand";
import { QUIET, childActivity, grownUpActivity, type FamilyActivity } from "./state";

const STALE_AFTER_MS = 15 * 60_000;
const widgetsAvailable = () => requireOptionalNativeModule("ExpoWidgets") !== null;

export function useActivityMirror(): FamilyActivity | null {
  const { macs, mode } = useLinks();
  const { byMac } = useMacData();
  const child = useOptionalChild();

  let activity: FamilyActivity | null = null;
  if (mode === "child") {
    const rows = conversationRows(macs, byMac, child?.questionsRoots ?? {});
    activity = childActivity({
      building: rows.filter((row) => row.state === "working").length,
      waiting: rows.filter((row) => row.state === "waiting").length,
      builder: BUILDER_NAME,
    });
  } else if (mode === "grown-up") {
    const names = macs.flatMap((mac) => {
      const state = byMac[mac.macId];
      return (state?.requests ?? [])
        .filter((request) => !request.lapsed)
        .map(
          (request) =>
            state?.status?.children.find((c) => c.id === request.childId)?.name ?? "A child",
        );
    });
    activity = grownUpActivity({ waitingChildNames: names, waitingCount: names.length });
  }

  const key = activity === null ? "none" : `${activity.phase}:${activity.headline}`;
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!widgetsAvailable() || lastKey.current === key) return;
    lastKey.current = key;
    void (async () => {
      const [{ default: live }, { default: widget }] = await Promise.all([
        import("../widgets/AgentActivity"),
        import("../widgets/FamilyStatus"),
      ]);
      widget.updateSnapshot(activity ?? { ...QUIET });
      const running = live.getInstances();
      if (activity === null) {
        await Promise.all(running.map((instance) => instance.end("default")));
        return;
      }
      const stale = new Date(Date.now() + STALE_AFTER_MS);
      if (running.length > 0) {
        await Promise.all(running.map((instance) => instance.update(activity!, stale)));
      } else {
        live.start(activity, undefined, stale);
      }
    })().catch((cause: unknown) => {
      if (__DEV__) console.warn("[skycot] Live Activity:", cause);
    });
  }, [key, activity]);
  return activity;
}
