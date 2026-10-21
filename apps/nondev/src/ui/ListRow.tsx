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
  /** For rows that open and close content below them: announced as a disclosure. */
  readonly expanded?: boolean;
  /** Why the row cannot be chosen; shown as a tooltip and read with the row. */
  readonly disabledReason?: string;
}

/**
 * One inset-grouped row (Settings / Apple Pay sheet style). Renders a button or
 * link when it is actionable and a plain div otherwise, so the semantics follow
 * the behaviour instead of the look. Always a list item: `List` is the list.
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
  expanded,
  disabledReason,
}: ListRowProps) {
  const interactive = onClick !== undefined || href !== undefined;
  const classes = [
    "fm-listrow",
    interactive ? "fm-listrow--interactive" : "",
    selected ? "fm-listrow--selected" : "",
    disabled ? "fm-listrow--disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      <span className="fm-listrow__leading">{leading}</span>
      <span className="fm-listrow__body">
        <span className="fm-listrow__title">{title}</span>
        {subtitle ? <span className="fm-listrow__subtitle">{subtitle}</span> : null}
        {disabled && disabledReason ? (
          <span className="fm-listrow__subtitle">{disabledReason}</span>
        ) : null}
      </span>
      <span className="fm-listrow__trailing">
        {trailing}
        {chevron ? (
          <ChevronRight size={14} strokeWidth={1.8} className="fm-listrow__chevron" aria-hidden />
        ) : null}
      </span>
    </>
  );
  // Links to the wider web leave the app, so they open beside it.
  const external = href !== undefined && /^https?:\/\//i.test(href);
  return (
    <li className="fm-list__item">
      {href !== undefined ? (
        <a
          className={classes}
          href={href}
          aria-current={selected ? "true" : undefined}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
        >
          {content}
        </a>
      ) : onClick !== undefined ? (
        <button
          type="button"
          className={classes}
          onClick={onClick}
          disabled={disabled}
          aria-pressed={selected && expanded === undefined ? true : undefined}
          aria-expanded={expanded}
        >
          {content}
        </button>
      ) : (
        <div className={classes}>{content}</div>
      )}
    </li>
  );
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
  // The explicit role keeps list semantics in Safari, which drops them when
  // list-style is none.
  return (
    <ul role="list" aria-label={label} className={`fm-list${plain ? " fm-list--plain" : ""}`}>
      {children}
    </ul>
  );
}

/**
 * Non-row content that belongs inside a List (a how-to card under a provider
 * row, an inline form): a presentational item, so the list stays a list of
 * items for assistive tech.
 */
export function ListExtra({ children }: { readonly children: ReactNode }) {
  return (
    <li role="presentation" className="fm-list__item fm-list__extra">
      {children}
    </li>
  );
}
