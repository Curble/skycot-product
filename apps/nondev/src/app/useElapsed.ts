import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/shell";
import { useEffect, useState } from "react";

/**
 * "2 min 10 s"-style label for the status strip. Ticks once a second only while
 * `active`; a finished run shows its final duration without a timer.
 */
export function useElapsedLabel(startedAt: string | null, endedAt: string | null, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  if (startedAt === null) return null;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;
  const end = !active && endedAt !== null ? Date.parse(endedAt) : now;
  return formatWorkingDurationLabel(Math.max(0, end - start));
}
