import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type PillTone = "neutral" | "provider" | "waiting" | "ok" | "working" | "danger";

/** Status capsule: "Using Claude", "Step 2 of 4 · paused for your answer", "iPhone linked". */
export function Pill({
  children,
  tone = "neutral",
  size = "md",
  icon: Icon,
  dot = true,
}: {
  readonly children: ReactNode;
  readonly tone?: PillTone;
  readonly size?: "sm" | "md";
  readonly icon?: LucideIcon;
  readonly dot?: boolean;
}) {
  const classes = ["fm-pill", `fm-pill--${tone}`, size === "sm" ? "fm-pill--sm" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes}>
      {Icon ? (
        <Icon size={12} strokeWidth={1.8} aria-hidden />
      ) : dot ? (
        <span className="fm-pill__dot" aria-hidden />
      ) : null}
      <span className="fm-pill__label">{children}</span>
    </span>
  );
}
