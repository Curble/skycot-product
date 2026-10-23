// Loads one recap. The engine refuses until a grown-up's "yes" is open on this device, so the
// code sheet asks first (unless one is already open) and the recap loads after it; the engine is
// not asked before the code. A parent who cancels sees a calm locked state.
import { useEffect, useEffectEvent, useState } from "react";

import { useFamily } from "../family/FamilyProvider";
import { fetchRecap } from "./api";
import { recapOpenOn, type RecapRange, type RecapReport } from "./recap";

export type RecapState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly report: RecapReport }
  | { readonly kind: "locked" }
  | { readonly kind: "failed"; readonly message: string };

export function useRecap(childId: string | null, range: RecapRange) {
  const family = useFamily();
  const [attempt, setAttempt] = useState(0);
  // Each answer is kept with the question it answers, so a new child, range or retry reads as
  // loading without resetting state inside the effect.
  const key = `${childId}:${range}:${attempt}`;
  const [answer, setAnswer] = useState<{ readonly key: string; readonly state: RecapState }>({
    key: "",
    state: { kind: "loading" },
  });
  const askForCode = useEffectEvent(() => family.requireParentCode("seeRecap"));
  // A grown-up's own device is the grown-up: the engine opens the recap to it without the code.
  const openOnThisDevice = useEffectEvent(
    () =>
      family.profile.me.kind === "grown-up" || recapOpenOn(family.profile.openUntil, Date.now()),
  );

  useEffect(() => {
    if (childId === null) return;
    let cancelled = false;
    const setState = (state: RecapState) => setAnswer({ key, state });
    const codeFirst = async () => {
      const ok = await askForCode();
      if (!cancelled && !ok) setState({ kind: "locked" });
      return ok && !cancelled;
    };
    void (async () => {
      if (!openOnThisDevice() && !(await codeFirst())) return;
      let result = await fetchRecap(childId, range);
      // The "yes" ran out between the check and the answer: ask once more.
      if (!result.ok && result.reason === "forbidden") {
        if (cancelled || !(await codeFirst())) return;
        result = await fetchRecap(childId, range);
      }
      if (cancelled) return;
      setState(
        result.ok
          ? { kind: "ready", report: result.value }
          : { kind: "failed", message: result.message },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [childId, range, key]);

  const state: RecapState = answer.key === key ? answer.state : { kind: "loading" };
  return { state, retry: () => setAttempt((count) => count + 1) };
}
