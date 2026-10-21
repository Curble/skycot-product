import type { ReactNode } from "react";

export type ProgressTone = "accent" | "green" | "orange" | "red";

export function ProgressBar({
  value,
  max = 1,
  tone = "accent",
  thin = false,
  label,
}: {
  /** 0..max. */
  readonly value: number;
  readonly max?: number;
  readonly tone?: ProgressTone;
  readonly thin?: boolean;
  readonly label: string;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`fm-progress fm-progress--${tone}${thin ? " fm-progress--thin" : ""}`}
    >
      <span className="fm-progress__bar" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

/**
 * "Today's allowance" card body. Only render it with real figures: the engine's
 * usage summary is a log scan, so Home hides this until a cheap source exists.
 */
export function AllowanceMeter({
  title = "Today's allowance",
  used,
  limit,
  currency = "$",
  footnote,
}: {
  readonly title?: string;
  readonly used: number;
  readonly limit: number;
  readonly currency?: string;
  readonly footnote?: ReactNode;
}) {
  const percent = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const tone: ProgressTone = percent >= 90 ? "red" : percent >= 70 ? "orange" : "green";
  return (
    <div>
      <div className="fm-allowance__row">
        <span>{title}</span>
        <b>{percent}% used</b>
      </div>
      <div className="fm-allowance__big">
        {currency}
        {used.toFixed(2)}
        <small>
          of {currency}
          {limit.toFixed(0)}
        </small>
      </div>
      <ProgressBar value={used} max={limit} tone={tone} label={`${title}: ${percent}% used`} />
      {footnote ? <p className="fm-allowance__foot">{footnote}</p> : null}
    </div>
  );
}
