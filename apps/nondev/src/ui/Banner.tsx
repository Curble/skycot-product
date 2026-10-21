import { AlertCircle, Info, WifiOff } from "lucide-react";
import type { ReactNode } from "react";

export type BannerTone = "warning" | "danger" | "info" | "offline";

/**
 * A calm, full-width notice: "Can't reach your Mac. Trying again…". Never shows
 * raw error strings; callers pass plain sentences.
 */
export function Banner({
  tone = "warning",
  children,
  action,
}: {
  readonly tone?: BannerTone;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  const Icon = tone === "offline" ? WifiOff : tone === "info" ? Info : AlertCircle;
  const classes = [
    "fm-banner",
    tone === "danger" ? "fm-banner--danger" : "",
    tone === "info" ? "fm-banner--info" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} role="status">
      <span className="fm-banner__icon" aria-hidden>
        <Icon size={15} strokeWidth={1.8} />
      </span>
      <span className="fm-banner__text">{children}</span>
      {action}
    </div>
  );
}
