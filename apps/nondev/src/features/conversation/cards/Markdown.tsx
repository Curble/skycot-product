// A small, safe Markdown renderer for what the Crew says: paragraphs, headings,
// lists, quotes, fenced code, bold/italic/inline code and http(s) links. It
// builds React nodes directly (never raw HTML) and ignores anything else, so a
// provider can't inject markup into the chat. apps/web uses react-markdown +
// remark-gfm, which would drag the web store graph into this bundle.
import { Fragment, type ReactNode } from "react";

import { Highlight } from "../../../ui/Highlight";

type Block =
  | { readonly kind: "p"; readonly text: string }
  | { readonly kind: "h"; readonly level: number; readonly text: string }
  | { readonly kind: "ul"; readonly items: ReadonlyArray<string> }
  | { readonly kind: "ol"; readonly items: ReadonlyArray<string>; readonly start: number }
  | { readonly kind: "quote"; readonly text: string }
  | { readonly kind: "code"; readonly text: string; readonly lang: string | null }
  | { readonly kind: "hr" };

const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const CONTINUATION = /^\s{2,}(\S.*)$/;

export function parseMarkdown(source: string): ReadonlyArray<Block> {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Array<Block> = [];
  let paragraph: Array<string> = [];
  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "p", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const code: Array<string> = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i]!)) {
        code.push(lines[i]!);
        i += 1;
      }
      blocks.push({ kind: "code", text: code.join("\n"), lang: fence[1] || null });
      continue;
    }
    if (line.trim().length === 0) {
      flush();
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: "hr" });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "h", level: heading[1]!.length, text: heading[2]! });
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      const parts = [quote[1]!];
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1]!)) {
        i += 1;
        parts.push(QUOTE.exec(lines[i]!)![1]!);
      }
      blocks.push({ kind: "quote", text: parts.join(" ") });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = numbered !== null && bullet === null;
      const items: Array<string> = [];
      let current = ordered ? numbered![2]! : bullet![1]!;
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!;
        const nextBullet = BULLET.exec(next);
        const nextNumbered = NUMBERED.exec(next);
        if (ordered ? nextNumbered && !nextBullet : nextBullet) {
          items.push(current);
          current = ordered ? nextNumbered![2]! : nextBullet![1]!;
          i += 1;
          continue;
        }
        const continuation = CONTINUATION.exec(next);
        if (continuation && !nextBullet && !nextNumbered) {
          current = `${current} ${continuation[1]!}`;
          i += 1;
          continue;
        }
        break;
      }
      items.push(current);
      blocks.push(
        ordered ? { kind: "ol", items, start: Number(numbered![1]) || 1 } : { kind: "ul", items },
      );
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

// Underscore emphasis only at word edges, so snake_case names stay intact.
// Any `[label](target)` is matched; only http(s) and mailto targets become
// links, everything else (javascript:, data:, relative paths) shows its label.
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(?<!\w)(__[^_\n]+__)(?!\w)|(\*[^*\n]+\*)|(?<!\w)(_[^_\n]+_)(?!\w)|(\[[^\]\n]+\]\((?:[^()\s]|\([^()\s]*\))+\))/;

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

/** "example.com" for an http(s) link; null for mailto. Shown so a reader knows where a link goes. */
export function linkHost(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function renderInline(text: string): ReactNode {
  const nodes: Array<ReactNode> = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (!match || match.index === undefined) {
      key += 1;
      nodes.push(<Highlight key={`t${key}`} text={rest} />);
      break;
    }
    if (match.index > 0) {
      key += 1;
      nodes.push(<Highlight key={`t${key}`} text={rest.slice(0, match.index)} />);
    }
    const token = match[0];
    key += 1;
    if (token.startsWith("`")) {
      nodes.push(
        <code key={key}>
          <Highlight text={token.slice(1, -1)} />
        </code>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{renderInline(token.slice(2, -2))}</strong>);
    } else if (token.startsWith("*") || token.startsWith("_")) {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1))}</em>);
    } else {
      const close = token.indexOf("](");
      const label = token.slice(1, close);
      const href = token.slice(close + 2, -1);
      if (!SAFE_HREF.test(href)) {
        nodes.push(<Fragment key={key}>{renderInline(label)}</Fragment>);
      } else {
        const host = linkHost(href);
        nodes.push(
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {renderInline(label)}
            {host && !label.includes(host) ? <span className="fm-md__host">({host})</span> : null}
          </a>,
        );
      }
    }
    rest = rest.slice(match.index + token.length);
  }
  return nodes.length === 1 ? nodes[0] : <>{nodes}</>;
}

/** Content-derived keys: blocks have no identity, and index keys reorder badly while streaming. */
function keyer() {
  const seen = new Map<string, number>();
  return (base: string) => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  };
}

export function Markdown({
  text,
  className,
}: {
  readonly text: string;
  readonly className?: string;
}) {
  const blocks = parseMarkdown(text);
  const key = keyer();
  return (
    <div className={className ? `fm-md ${className}` : "fm-md"}>
      {blocks.map((block) => {
        switch (block.kind) {
          case "p":
            return <p key={key(`p:${block.text}`)}>{renderInline(block.text)}</p>;
          case "h": {
            // Headings inside a chat bubble read as section labels, never page titles.
            const Tag = block.level <= 2 ? "h3" : "h4";
            return <Tag key={key(`h:${block.text}`)}>{renderInline(block.text)}</Tag>;
          }
          case "ul":
          case "ol": {
            const itemKey = keyer();
            const children = block.items.map((item) => (
              <li key={itemKey(item)}>{renderInline(item)}</li>
            ));
            return block.kind === "ol" ? (
              <ol key={key(`ol:${block.items[0] ?? ""}`)} start={block.start}>
                {children}
              </ol>
            ) : (
              <ul key={key(`ul:${block.items[0] ?? ""}`)}>{children}</ul>
            );
          }
          case "quote":
            return <blockquote key={key(`q:${block.text}`)}>{renderInline(block.text)}</blockquote>;
          case "code":
            return (
              <pre key={key(`code:${block.text.slice(0, 40)}`)} data-lang={block.lang ?? undefined}>
                <code>
                  <Highlight text={block.text} />
                </code>
              </pre>
            );
          case "hr":
            return <hr key={key("hr")} />;
          default:
            return <Fragment key={key("other")} />;
        }
      })}
    </div>
  );
}

/** First meaningful line without markdown markers, for previews and meta lines. */
export function plainFirstLine(text: string, max = 160): string {
  const line =
    text
      .split(/\r?\n/)
      .find((part) => part.trim().length > 0)
      ?.trim() ?? "";
  const clean = line
    .replace(/^#+\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/[*_`]/g, "");
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
