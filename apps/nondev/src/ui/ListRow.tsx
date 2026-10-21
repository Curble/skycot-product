import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

interface ListRowProps {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  /** Icon, avatar or step badge on the left. */
  readonly leading?: ReactNode;
  /** Text, badge or button on the right. */
  readonly trailing?: ReactNode;
  readonly chevron?: boolean;
  readonly selected?: boolean;
  readonly onClick?: () => void;
  readonly href?: string;
  readonly disabled?: boolean;
}

/**
 * One inset-grouped row (Settings / Apple Pay sheet style). Renders a button or
 * link when it is actionable and a plain div otherwise, so the semantics follow
 * the behaviour instead of the look.
 */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  chevron = false,
  selected = false,
  onClick,
  href,
  disabled = false,
}: ListRowProps) {
  const interactive = onClick !== undefined || href !== undefined;
  const classes = [
    "fm-listrow",
    interactive ? "fm-listrow--interactive" : "",
    selected ? "fm-listrow--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      <span className="fm-listrow__leading">{leading}</span>
      <span className="fm-listrow__body">
        <span className="fm-listrow__title">{title}</span>
        {subtitle ? <span className="fm-listrow__subtitle">{subtitle}</span> : null}
      </span>
      <span className="fm-listrow__trailing">
        {trailing}
        {chevron ? (
          <ChevronRight size={14} strokeWidth={1.8} className="fm-listrow__chevron" aria-hidden />
        ) : null}
      </span>
    </>
  );
  if (href !== undefined) {
    return (
      <a className={classes} href={href} aria-current={selected ? "true" : undefined}>
        {content}
      </a>
    );
  }
  if (onClick !== undefined) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onClick}
        disabled={disabled}
        aria-pressed={selected ? true : undefined}
      >
        {content}
      </button>
    );
  }
  return <div className={classes}>{content}</div>;
}

/** Inset-grouped container for ListRows. `plain` drops the grey background. */
export function List({
  children,
  plain = false,
  label,
}: {
  readonly children: ReactNode;
  readonly plain?: boolean;
  readonly label?: string;
}) {
  return (
    <div role="list" aria-label={label} className={`fm-list${plain ? " fm-list--plain" : ""}`}>
      {children}
    </div>
  );
}
