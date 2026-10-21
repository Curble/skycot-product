import type { ReactNode } from "react";

import { List } from "../../ui/ListRow";

/** System Settings grouped list: small grey title, inset rows, optional footnote. */
export function SettingsGroup({
  title,
  children,
  footer,
  label,
}: {
  readonly title?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly label?: string;
}) {
  return (
    <section className="fm-group">
      {title ? <h3 className="fm-group__title">{title}</h3> : null}
      <List {...((label ?? title) ? { label: (label ?? title)! } : {})}>{children}</List>
      {footer ? <p className="fm-group__footer">{footer}</p> : null}
    </section>
  );
}
