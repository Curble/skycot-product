import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  readonly icon?: LucideIcon;
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="fm-empty" role="status">
      {Icon ? (
        <span className="fm-empty__icon" aria-hidden>
          <Icon size={22} strokeWidth={1.6} />
        </span>
      ) : null}
      <h3 className="fm-empty__title">{title}</h3>
      {children ? <p className="fm-empty__text">{children}</p> : null}
      {action ? <div style={{ marginTop: 10 }}>{action}</div> : null}
    </div>
  );
}
