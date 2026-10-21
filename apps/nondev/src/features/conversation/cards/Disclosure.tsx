import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { renderInline } from "./Markdown";

/**
 * "Show details (for your developer)": the one place a card exposes raw paths,
 * commands and tool names. Native <details> so it works without JS state and
 * never animates.
 */
export function Disclosure({
  summary = "Show details (for your developer)",
  children,
}: {
  readonly summary?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <details className="fm-details">
      <summary className="fm-details__summary">
        <ChevronRight size={13} strokeWidth={2} aria-hidden className="fm-details__chevron" />
        {summary}
      </summary>
      <div className="fm-details__body">{children}</div>
    </details>
  );
}

/** Monospace log lines inside a Disclosure. */
export function TechnicalList({
  lines,
}: {
  readonly lines: ReadonlyArray<{
    readonly key: string;
    readonly label?: string | undefined;
    readonly text: string;
    readonly time?: string | undefined;
    readonly tone?: "neutral" | "failed" | "denied" | undefined;
    /** The assistant's own words (a reply, a reasoning note): Markdown, not a command. */
    readonly prose?: boolean | undefined;
  }>;
}) {
  if (lines.length === 0) return <p className="fm-details__empty">Nothing to show yet.</p>;
  return (
    <ol className="fm-details__log">
      {lines.map((line) => (
        <li key={line.key} data-tone={line.tone ?? "neutral"}>
          {line.time ? <span className="fm-details__time">{line.time}</span> : null}
          {line.label ? <span className="fm-details__label">{line.label}</span> : null}
          {line.prose ? (
            <span className="fm-details__code">{renderInline(line.text)}</span>
          ) : (
            <code className="fm-details__code">{line.text}</code>
          )}
        </li>
      ))}
    </ol>
  );
}
