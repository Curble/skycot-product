// The simplified code view behind "Peek at the code": a few lines, three colours, a legend.
// Plain text on purpose (no syntax highlighter): it loads instantly and reads like a page.
import { describeFile } from "../../plain/changes";
import type { Peek } from "./peek";

const MARK = { added: "+", removed: "−", same: " " } as const;

export function PeekAtCode({ peek }: { readonly peek: Peek }) {
  if (peek.files.length === 0) {
    return <p className="fm-explain__note">No code lines to show for this change.</p>;
  }
  return (
    <div className="fm-peek">
      <ul className="fm-peek__legend" aria-label="What the colours mean">
        <li data-kind="added">New line</li>
        <li data-kind="removed">Taken out</li>
        <li data-kind="same">Stayed the same</li>
      </ul>
      {peek.files.map((file) => (
        <figure key={file.path} className="fm-peek__file">
          <figcaption>
            <b>{describeFile(file.path).noun}</b> <code>{file.path}</code>
          </figcaption>
          <pre className="fm-peek__code">
            {file.lines.map((line) => (
              <span key={line.key} className="fm-peek__line" data-kind={line.kind}>
                <span className="fm-peek__mark" aria-hidden>
                  {MARK[line.kind]}
                </span>
                <span className="fm-peek__sr">
                  {line.kind === "added" ? "New: " : line.kind === "removed" ? "Taken out: " : ""}
                </span>
                {line.text.length > 0 ? line.text : " "}
                {"\n"}
              </span>
            ))}
          </pre>
        </figure>
      ))}
      {peek.moreLines > 0 || peek.moreFiles > 0 ? (
        <p className="fm-explain__note">
          {peek.moreFiles > 0
            ? `And ${peek.moreFiles} more ${peek.moreFiles === 1 ? "file" : "files"} — "Show the code changes" on the What-changed card has everything.`
            : `And ${peek.moreLines} more changed ${peek.moreLines === 1 ? "line" : "lines"} — "Show the code changes" on the What-changed card has everything.`}
        </p>
      ) : null}
    </div>
  );
}
