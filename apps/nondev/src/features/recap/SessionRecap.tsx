// The grown-up's recap cards. "Here's what Ava made today" comes up inside the asleep screen at
// bedtime or when the day's time runs out (after the parent code). "Here's what Ava did last
// time" is a sheet when a grown-up opens the Family settings with the parent code and the
// child's last work session is over; dismissing it ("Got it") keeps it away for that session.
import type { EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { CalendarDays, Printer } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

import { navigate, recapHref } from "../../router";
import { enabledEnvironmentIdsAtom } from "../../state/catalog";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { Mascot } from "../brand/Mascot";
import { childLabel, type FamilyChild } from "../family/children";
import { useFamily } from "../family/FamilyProvider";
import { onParentYes } from "../family/store";
import { fetchRecap } from "./api";
import {
  markLastSessionSeen,
  recapHeadline,
  shouldOfferLastSession,
  type RecapReport,
} from "./recap";
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

interface Offer {
  readonly childId: string;
  readonly report: RecapReport;
}
let offered: Offer | null = null;
const listeners = new Set<() => void>();
function setOffered(next: Offer | null) {
  offered = next;
  for (const listener of listeners) listener();
}

/**
 * Mounted once (beside the asleep screen): when a grown-up opens the Family settings with the
 * parent code, and the child chosen on this device has a last work session that is over and not
 * yet dismissed, it shows "Here's what <child> did last time" once. The engine decides where
 * a session starts and ends; it answers only after the grown-up's "yes", so a child's view never
 * gets it (and this only runs on a parent code, never on a child's own taps).
 */
export function SessionRecapHost() {
  const family = useFamily();
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const environmentId = environmentIds[0] ?? null;
  const offer = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => offered,
    () => null,
  );
  const current = family.profile.currentChildId;

  useEffect(
    () =>
      onParentYes((purpose) => {
        // Advanced mode leaves for the developer interface; the card would only flash.
        if (purpose !== "settings" || current === null) return;
        void fetchRecap(current, "last-session").then((result) => {
          if (result.ok && shouldOfferLastSession(result.value, Date.now())) {
            setOffered({ childId: current, report: result.value });
          }
        });
      }),
    [current],
  );

  if (offer === null) return null;
  const { childId, report } = offer;
  const index = family.profile.children.findIndex((child) => child.id === childId);
  const child = index < 0 ? null : family.profile.children[index]!;
  if (child === null) return null;
  const name = childLabel(child, index);
  const close = () => {
    if (report.session) markLastSessionSeen(report.session.id);
    setOffered(null);
  };
  return (
    <Sheet
      open
      onClose={close}
      art={<Mascot pose="hello" size={56} decorative />}
      title={recapHeadline(report, name)}
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
          <Button icon={Printer} onClick={() => window.print()}>
            Print or save as PDF
          </Button>
          <Button variant="primary" onClick={close}>
            Got it
          </Button>
        </>
      }
    >
      <SessionRecapBody
        report={report}
        child={child}
        name={name}
        environmentId={environmentId}
        hero={false}
      />
    </Sheet>
  );
}
