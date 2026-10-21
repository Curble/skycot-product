// The real diff behind "Show the code changes". Loaded lazily (see
// ReviewSection) so the syntax highlighter and diff workers stay out of the
// conversation's first paint. The only monospace surface in the app.
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, useSyncExternalStore, type MouseEvent } from "react";

import { StyledDiffCodeView } from "~/components/diffs/StyledDiffCodeView";
import { getRenderablePatch, resolveDiffThemeName, resolveFileDiffPath } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";

function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** Follows `html.dark`, which app/theme.ts keeps in step with the chosen appearance. */
function useAppearance(): "light" | "dark" {
  return useSyncExternalStore(
    subscribeToTheme,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "light",
  );
}

export default function CodeChanges({
  diff,
  scope,
}: {
  readonly diff: string;
  readonly scope: string;
}) {
  const appearance = useAppearance();
  const patch = getRenderablePatch(diff, scope);
  // Files start folded so the list of names reads first; a tap on a header opens one.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  if (patch === null) {
    return <p className="fm-code-changes__empty">No code changes to show.</p>;
  }
  if (patch.kind === "raw") {
    return <pre className="fm-code-changes__raw">{patch.text}</pre>;
  }

  const files = patch.files.map((fileDiff, index) => ({
    id: `${scope}:${index}`,
    path: resolveFileDiffPath(fileDiff),
    fileDiff,
  }));
  const items = files.map(({ id, fileDiff }) => ({
    id,
    type: "diff" as const,
    fileDiff,
    collapsed: !expanded.has(id),
  }));
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // The viewer paints its own header; a click anywhere on it folds or unfolds
  // the file, the same gesture the chevron offers to keyboard users.
  const onHeaderClick = (event: MouseEvent<HTMLDivElement>) => {
    const path = event.nativeEvent.composedPath();
    if (path.some((node) => node instanceof HTMLButtonElement)) return;
    const header = path.find(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && node.hasAttribute("data-diffs-header"),
    );
    const title = header?.querySelector("[data-title]")?.textContent?.trim();
    if (!title) return;
    const file = files.find((candidate) => candidate.path === title);
    if (file) toggle(file.id);
  };

  return (
    <div
      className="fm-code-changes"
      data-appearance={appearance}
      onClickCapture={onHeaderClick}
      // The viewer virtualises rows, so it needs a real height; while every file
      // is folded that height is just the list of names, not an empty box.
      style={expanded.size === 0 ? { height: Math.min(440, files.length * 34 + 14) } : undefined}
    >
      <StyledDiffCodeView
        items={items}
        renderHeaderPrefix={(item) => {
          const open = expanded.has(item.id);
          const Icon = open ? ChevronDown : ChevronRight;
          return (
            <button
              type="button"
              className="fm-code-changes__fold"
              aria-expanded={open}
              aria-label={open ? "Hide this file's changes" : "Show this file's changes"}
              onClick={() => toggle(item.id)}
            >
              <Icon size={14} strokeWidth={2} aria-hidden />
            </button>
          );
        }}
        options={{
          diffStyle: "unified",
          lineDiffType: "none",
          overflow: "wrap",
          theme: resolveDiffThemeName(appearance),
          themeType: appearance,
          preferredHighlighter: PREFERRED_HIGHLIGHTER,
          stickyHeaders: true,
        }}
      />
    </div>
  );
}
