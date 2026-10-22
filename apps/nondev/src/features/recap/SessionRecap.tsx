// "Here's what Ava made today": the end-of-session card for the grown-up. It comes up when a
// child's session ends — inside the asleep screen at bedtime or when the day's time runs out
// (after the parent code), and as a sheet when a parent unlocks SKYCOT with the code while a
// child has used it today. Once dismissed it stays away for that child until tomorrow.
import type { EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { CalendarDays, Printer } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { navigate, recapHref } from "../../router";
import { enabledEnvironmentIdsAtom } from "../../state/catalog";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { Mascot } from "../brand/Mascot";
import { childLabel, type FamilyChild } from "../family/children";
import { useFamily } from "../family/FamilyProvider";
import { onParentYes } from "../family/store";
import { refreshToday } from "../family-limits/store";
import { fetchRecap } from "./api";
import type { RecapReport } from "./recap";
import { RecapReportView } from "./RecapReportView";

const SEEN_PREFIX = "skycot:recap-seen:";

function localDate(now = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

export function sessionRecapSeen(childId: string): boolean {
  try {
    return window.localStorage.getItem(`${SEEN_PREFIX}${childId}`) === localDate();
  } catch {
    return false;
  }
}

export function markSessionRecapSeen(childId: string) {
  try {
    window.localStorage.setItem(`${SEEN_PREFIX}${childId}`, localDate());
  } catch {
    // Blocked storage: the card may offer itself again today, which is harmless.
  }
}

/** The highlights, ready to show: loaded once a grown-up's "yes" is open. */
export function SessionRecapBody({
  report,
  child,
  name,
  environmentId,
  hero = true,
}: {
  readonly report: RecapReport;
  readonly child: FamilyChild;
  readonly name: string;
  readonly environmentId: EnvironmentId | null;
  readonly hero?: boolean;
}) {
  return (
    <RecapReportView
      report={report}
      child={child}
      name={name}
      environmentId={environmentId}
      compact
      hero={hero}
    />
  );
}

let offered: string | null = null;
const listeners = new Set<() => void>();
function setOffered(childId: string | null) {
  offered = childId;
  for (const listener of listeners) listener();
}

/**
 * Mounted once (beside the asleep screen): when a parent unlocks SKYCOT with the code for the
 * Family settings (switching child, changing limits…), the child using this device has used it today, and the
 * card was not dismissed today, it shows "Here's what <child> made today".
 */
export function SessionRecapHost() {
  const family = useFamily();
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const environmentId = environmentIds[0] ?? null;
  const childId = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => offered,
    () => null,
  );
  const [answer, setAnswer] = useState<{
    readonly childId: string;
    readonly report: RecapReport | null;
    readonly problem: string | null;
  } | null>(null);
  const current = family.profile.currentChildId;

  useEffect(
    () =>
      onParentYes((purpose) => {
        // Advanced mode leaves for the developer interface; the card would only flash.
        if (purpose !== "settings") return;
        if (current === null || sessionRecapSeen(current)) return;
        void refreshToday().then((today) => {
          const day = today?.children.find((entry) => entry.childId === current);
          if (day && (day.limits.usedMinutes > 0 || day.limits.turns > 0)) setOffered(current);
        });
      }),
    [current],
  );

  useEffect(() => {
    if (childId === null) return;
    let cancelled = false;
    void fetchRecap(childId, "session").then((result) => {
      if (cancelled) return;
      setAnswer(
        result.ok
          ? { childId, report: result.value, problem: null }
          : { childId, report: null, problem: result.message },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [childId]);

  if (childId === null) return null;
  const report = answer?.childId === childId ? answer.report : null;
  const problem = answer?.childId === childId ? answer.problem : null;
  const index = family.profile.children.findIndex((child) => child.id === childId);
  const child = index < 0 ? null : family.profile.children[index]!;
  if (child === null) return null;
  const name = childLabel(child, index);
  const close = () => {
    markSessionRecapSeen(childId);
    setOffered(null);
  };
  return (
    <Sheet
      open
      onClose={close}
      art={<Mascot pose="hello" size={56} decorative />}
      title={`Here's what ${name} made today`}
      description="For grown-ups. Kept on this Mac; nothing is emailed or uploaded."
      wide
      actions={
        <>
          <Button
            icon={CalendarDays}
            onClick={() => {
              close();
              navigate(recapHref(childId));
            }}
          >
            See the week
          </Button>
          <Button icon={Printer} disabled={report === null} onClick={() => window.print()}>
            Print or save as PDF
          </Button>
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </>
      }
    >
      {problem ? (
        <Banner tone="warning">{problem}</Banner>
      ) : report === null ? (
        <p className="fm-help">Putting today together…</p>
      ) : (
        <SessionRecapBody
          report={report}
          child={child}
          name={name}
          environmentId={environmentId}
          hero={false}
        />
      )}
    </Sheet>
  );
}
