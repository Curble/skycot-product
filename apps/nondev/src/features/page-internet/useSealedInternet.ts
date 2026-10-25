// The sealed frame's side of "a grown-up says yes once per page": which internet sites the page
// may use (the engine's list for that page, Family profile only) and which ones it tried that
// still need a yes. The frame's reporter (BLOCKED_REPORTER) names a stopped address; only a
// message from this frame counts, and only an https site can ever be allowed.
import { reportedSite, MAX_PAGE_SITES } from "@t3tools/skycot-rules/page-internet";
import { useEffect, useState, type RefObject } from "react";

import { useFamily } from "../family/FamilyProvider";

export function useSealedInternet(
  page: string | null,
  frame: RefObject<HTMLIFrameElement | null>,
): {
  readonly enabled: boolean;
  readonly allowed: ReadonlyArray<string>;
  readonly asks: ReadonlyArray<string>;
} {
  const family = useFamily();
  const on = family.enabled && page !== null;
  const allowed = on
    ? (family.profile.pageInternet.find((entry) => entry.page === page)?.sites ?? [])
    : [];
  const [tried, setTried] = useState<ReadonlyArray<string>>([]);
  useEffect(() => {
    if (!on) return;
    const onMessage = (event: MessageEvent) => {
      if (frame.current === null || event.source !== frame.current.contentWindow) return;
      const site = reportedSite(event.data);
      if (site === null) return;
      setTried((current) =>
        current.includes(site) || current.length >= MAX_PAGE_SITES ? current : [...current, site],
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [on, frame]);
  return {
    enabled: family.enabled,
    allowed,
    asks: tried.filter((site) => !allowed.includes(site)),
  };
}
