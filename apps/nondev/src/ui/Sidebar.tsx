import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function SidebarSection({
  title,
  action,
  children,
}: {
  readonly title?: string;
  /** Small control at the right of the heading, e.g. an add button. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section>
      {title ? (
        <h2 className="fm-sidebar-section__title">
          <span>{title}</span>
          {action}
        </h2>
      ) : null}
      <ul className="fm-sidebar-section__items">{children}</ul>
    </section>
  );
}

interface SidebarItemProps {
  readonly icon?: LucideIcon;
  /** Emoji or other leading glyph when an icon does not fit (project avatars). */
  readonly glyph?: ReactNode;
  readonly label: string;
  readonly count?: number;
  /** Show an attention dot instead of a count. */
  readonly attention?: boolean;
  readonly selected?: boolean;
  readonly muted?: boolean;
  readonly onClick?: () => void;
  readonly href?: string;
}

export function SidebarItem({
  icon: Icon,
  glyph,
  label,
  count,
  attention = false,
  selected = false,
  muted = false,
  onClick,
  href,
}: SidebarItemProps) {
  const classes = [
    "fm-sidebar-item",
    selected ? "fm-sidebar-item--selected" : "",
    muted ? "fm-sidebar-item--muted" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      <span className="fm-sidebar-item__icon" aria-hidden>
        {Icon ? <Icon size={15} strokeWidth={1.8} /> : glyph}
      </span>
      <span className="fm-sidebar-item__label">{label}</span>
      {attention ? (
        <span className="fm-sidebar-item__dot" role="img" aria-label="Needs attention" />
      ) : count !== undefined && count > 0 ? (
        <span className="fm-sidebar-item__count">{count}</span>
      ) : null}
    </>
  );
  return (
    <li>
      {href !== undefined ? (
        <a className={classes} href={href} aria-current={selected ? "page" : undefined}>
          {content}
        </a>
      ) : (
        <button
          type="button"
          className={classes}
          onClick={onClick}
          aria-current={selected ? "page" : undefined}
        >
          {content}
        </button>
      )}
    </li>
  );
}
