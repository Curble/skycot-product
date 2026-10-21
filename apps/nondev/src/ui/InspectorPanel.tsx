import type { ReactNode } from "react";

/**
 * Right-hand rail (the Time Machine "Versions" column lives here). Width comes
 * from --fm-inspector-width; the shell decides when it is shown.
 */
export function InspectorPanel({
  title,
  lede,
  children,
  label,
}: {
  readonly title?: string;
  readonly lede?: ReactNode;
  readonly children: ReactNode;
  readonly label?: string;
}) {
  return (
    <aside className="fm-inspector" aria-label={label ?? title}>
      {title ? <h3 className="fm-inspector__title">{title}</h3> : null}
      {lede ? <p className="fm-inspector__lede">{lede}</p> : null}
      {children}
    </aside>
  );
}
