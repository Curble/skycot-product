import type { ReactNode } from "react";

/** A horizontal strip of controls under a view's edge. Children are laid out left to right. */
export function Toolbar({
  children,
  plain = false,
  label,
}: {
  readonly children: ReactNode;
  readonly plain?: boolean;
  readonly label?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={`fm-toolbar${plain ? " fm-toolbar--plain" : ""}`}
    >
      {children}
    </div>
  );
}

export function ToolbarTitle({
  children,
  detail,
}: {
  readonly children: ReactNode;
  readonly detail?: ReactNode;
}) {
  return (
    <span className="fm-toolbar__title">
      {children}
      {detail ? <span> › {detail}</span> : null}
    </span>
  );
}

export function ToolbarSpacer() {
  return <span className="fm-toolbar__spacer" aria-hidden />;
}
