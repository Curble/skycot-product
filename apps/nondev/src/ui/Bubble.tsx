import type { ReactNode } from "react";

export type BubbleAuthor = "me" | "crew";

/**
 * One message in the stream. `me` sits right in system blue, `crew` sits left
 * in grey; `full` spans the width for rich cards. `muted` is the quiet, borderless
 * note used for reasoning and system lines.
 */
export function Bubble({
  author,
  children,
  meta,
  full = false,
  muted = false,
}: {
  readonly author: BubbleAuthor;
  readonly children: ReactNode;
  /** Small line under the bubble: time, "Delivered · Ask me first". */
  readonly meta?: ReactNode;
  readonly full?: boolean;
  readonly muted?: boolean;
}) {
  const classes = ["fm-msg", `fm-msg--${author}`, full ? "fm-msg--full" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes}>
      {full ? (
        children
      ) : (
        <div className={`fm-bubble${muted ? " fm-bubble--muted" : ""}`}>{children}</div>
      )}
      {meta ? <div className="fm-msg__meta">{meta}</div> : null}
    </div>
  );
}

export function DayDivider({ children }: { readonly children: ReactNode }) {
  return <div className="fm-day">{children}</div>;
}

/** Static three dots: the Crew is composing. No animation, by the performance rules. */
export function TypingIndicator({ meta }: { readonly meta?: ReactNode }) {
  return (
    <div className="fm-msg fm-msg--crew">
      <div className="fm-typing" role="status" aria-label="Crew is typing">
        <i />
        <i />
        <i />
      </div>
      {meta ? <div className="fm-msg__meta">{meta}</div> : null}
    </div>
  );
}
