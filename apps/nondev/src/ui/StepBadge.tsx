import { Check, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type StepBadgeState = "done" | "now" | "todo" | "number" | "warn" | "ok" | "fail";

/**
 * The round leading badge of a checklist row (the mockup's `.lead`): a tick for
 * done, a pulsing-looking (static) blue dot for now, a number for upcoming.
 */
export function StepBadge({
  state,
  children,
  icon: Icon,
  label,
}: {
  readonly state: StepBadgeState;
  /** Step number or glyph; ignored for done/now. */
  readonly children?: ReactNode;
  readonly icon?: LucideIcon;
  readonly label?: string;
}) {
  return (
    <span
      className={`fm-step fm-step--${state}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {state === "done" || state === "ok" ? (
        <Check size={12} strokeWidth={2.6} />
      ) : state === "now" ? (
        "●"
      ) : state === "warn" || state === "fail" ? (
        Icon ? (
          <Icon size={12} strokeWidth={2.4} />
        ) : (
          "!"
        )
      ) : Icon ? (
        <Icon size={13} strokeWidth={2} />
      ) : (
        children
      )}
    </span>
  );
}
