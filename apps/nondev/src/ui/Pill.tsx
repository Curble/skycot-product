import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type PillTone = "neutral" | "provider" | "waiting" | "ok" | "working" | "danger";

/**
 * Status capsule: "Using Claude", "Step 2 of 4 · paused for your answer", "iPhone
 * linked". With `onClick` it is a button in the same clothes ("Ready to look at"
 * in the status strip jumps to the card).
 */
export function Pill({
  children,
  tone = "neutral",
  size = "md",
  icon: Icon,
  dot = true,
  onClick,
  label,
}: {
  readonly children: ReactNode;
  readonly tone?: PillTone;
  readonly size?: "sm" | "md";
  readonly icon?: LucideIcon;
  readonly dot?: boolean;
  readonly onClick?: () => void;
  /** Accessible name when the visible text is not enough ("Jump to what changed"). */
  readonly label?: string;
}) {
  const classes = [
    "fm-pill",
    `fm-pill--${tone}`,
    size === "sm" ? "fm-pill--sm" : "",
    onClick ? "fm-pill--button" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const inner = (
    <>
      {Icon ? (
        <Icon size={12} strokeWidth={1.8} aria-hidden />
      ) : dot ? (
        <span className="fm-pill__dot" aria-hidden />
      ) : null}
      <span className="fm-pill__label">{children}</span>
    </>
  );
  return onClick ? (
    <button type="button" className={classes} onClick={onClick} aria-label={label}>
      {inner}
    </button>
  ) : (
    <span className={classes} aria-label={label}>
      {inner}
    </span>
  );
}
