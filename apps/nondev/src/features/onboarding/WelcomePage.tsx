import { useId, type ReactNode } from "react";

/**
 * The welcome as a page that owns the window (not a sheet over the app): the mascot and the
 * step's title at the top, the step's content, and the buttons bottom-right. Styles live in
 * styles/welcome.css.
 */
export function WelcomePage({
  title,
  description,
  art,
  children,
  actions,
  sober = false,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly art: ReactNode;
  readonly children?: ReactNode;
  readonly actions: ReactNode;
  readonly sober?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <div className="fm-welcome">
      <div
        className="fm-welcome__column"
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        data-sober={sober ? "" : undefined}
      >
        <header className="fm-welcome__head">
          <span className="fm-welcome__art" aria-hidden>
            {art}
          </span>
          <h1 id={titleId} className="fm-welcome__title">
            {title}
          </h1>
          {description ? (
            <p id={descriptionId} className="fm-welcome__description">
              {description}
            </p>
          ) : null}
        </header>
        <div className="fm-welcome__body">{children}</div>
        <div className="fm-welcome__actions">{actions}</div>
      </div>
    </div>
  );
}
