import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type CardIconTone = "blue" | "green" | "orange" | "grey" | "red";

/**
 * The Apple link-preview / Apple Pay-sheet card: app-icon header, body,
 * optional footer with actions. Later agents compose Plan / Working / Approval /
 * What-changed cards out of this plus `List` + `ListRow`.
 */
export function Card({
  children,
  tinted = false,
  as: Tag = "section",
  label,
}: {
  readonly children: ReactNode;
  readonly tinted?: boolean;
  readonly as?: "section" | "div" | "article";
  readonly label?: string;
}) {
  return (
    <Tag className={`fm-card${tinted ? " fm-card--tinted" : ""}`} aria-label={label}>
      {children}
    </Tag>
  );
}

export function CardHeader({
  icon: Icon,
  tone = "blue",
  title,
  subtitle,
  trailing,
}: {
  readonly icon?: LucideIcon;
  readonly tone?: CardIconTone;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly trailing?: ReactNode;
}) {
  return (
    <header className="fm-card__header">
      {Icon ? (
        <span className={`fm-card__icon fm-card__icon--${tone}`} aria-hidden>
          <Icon size={18} strokeWidth={1.8} />
        </span>
      ) : null}
      <div className="fm-card__heading">
        <span className="fm-card__title">{title}</span>
        {subtitle ? <span className="fm-card__subtitle">{subtitle}</span> : null}
      </div>
      {trailing ? <div className="fm-card__trailing">{trailing}</div> : null}
    </header>
  );
}

export function CardBody({ children }: { readonly children: ReactNode }) {
  return <div className="fm-card__body">{children}</div>;
}

export function CardFooter({
  children,
  note,
}: {
  readonly children?: ReactNode;
  readonly note?: ReactNode;
}) {
  return (
    <footer className="fm-card__footer">
      {children}
      {note ? <span className="fm-card__footer-note">{note}</span> : null}
    </footer>
  );
}
