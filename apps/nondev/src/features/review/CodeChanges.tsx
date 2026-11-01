// The real diff behind "Show the code changes". Loaded lazily (see
// ReviewSection) so the syntax highlighter and diff workers stay out of the
// conversation's first paint. The only monospace surface in the app.
//
// A grown-up (never a child, never with Family on) can also add a short note to a changed line
// that rides with their next message: `lineNotes` is passed only for them, and without it no
// gutter button, click handler or note box exists at all.
import { ChevronDown, ChevronRight, MessageSquarePlus } from "lucide-react";
import { useState, useSyncExternalStore, type MouseEvent } from "react";

import { StyledDiffCodeView } from "~/components/diffs/StyledDiffCodeView";
import {
  fnv1a32,
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { randomUUID } from "~/lib/utils";

import { LineNoteEditor } from "../linecomment/LineNoteEditor";
import { addLineNote, useLineNotes, type LineNote } from "../linecomment/notes";

// The viewer's own line types, written out here because this app does not depend on its package.
type Side = "additions" | "deletions";
interface SelectedLineRange {
  readonly start: number;
  readonly end: number;
  readonly side?: Side;
  readonly endSide?: Side;
}
interface DiffLineAnnotation<T> {
  readonly side: Side;
  readonly lineNumber: number;
  readonly metadata: T;
}

/** The one thing an annotation carries: the note box being filled in, or a note already added. */
interface NoteSlot {
  readonly note: LineNote | null;
}

interface NoteDraft {
  readonly itemId: string;
  readonly path: string;
  readonly side: "additions" | "deletions";
  readonly line: number;
}

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
  lineNotes,
}: {
  readonly diff: string;
  readonly scope: string;
  /** Present only where line notes are allowed; the conversation the notes will be sent in. */
  readonly lineNotes?: { readonly threadId: string };
}) {
  const appearance = useAppearance();
  const patch = getRenderablePatch(diff, scope);
  // Files start folded so the list of names reads first; a tap on a header opens one.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const threadId = lineNotes?.threadId ?? "";
  const notes = useLineNotes(threadId);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [selectedLines, setSelectedLines] = useState<{
    readonly id: string;
    readonly range: SelectedLineRange;
  } | null>(null);

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
  // Pierre re-reads a controlled item only when its `version` changes
  // (CodeView.syncItemRecord). Without a version that tracks `collapsed`, a tap
  // flipped the chevron but the viewer kept its folded record and the file body
  // never mounted.
  const items = files.map(({ id, path, fileDiff }) => {
    const collapsed = !expanded.has(id);
    // Notes already added show under their line, so the note and its line read together.
    const annotations: DiffLineAnnotation<NoteSlot>[] =
      lineNotes === undefined
        ? []
        : [
            ...notes
              .filter((note) => note.path === path)
              .map((note) => ({
                side: note.removed ? ("deletions" as const) : ("additions" as const),
                lineNumber: note.line,
                metadata: { note },
              })),
            ...(draft?.itemId === id
              ? [{ side: draft.side, lineNumber: draft.line, metadata: { note: null } }]
              : []),
          ];
    const noted = annotations.map((a) => `${a.metadata.note?.id ?? "draft"}`).join(",");
    return {
      id,
      type: "diff" as const,
      fileDiff,
      collapsed,
      annotations,
      version: fnv1a32(`${collapsed ? 0 : 1}:${noted}`),
    };
  });
  const closeDraft = () => {
    setDraft(null);
    setSelectedLines(null);
  };
  const lineLabel = (path: string, line: number) => `${path} line ${line}`;
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
      <StyledDiffCodeView<NoteSlot>
        items={items}
        {...(lineNotes === undefined
          ? {}
          : {
              selectedLines,
              onSelectedLinesChange: setSelectedLines,
              renderGutterUtility: () => (
                <button
                  type="button"
                  className="fm-line-note__add"
                  aria-label="Add a note on this line"
                  title="Add a note on this line"
                >
                  <MessageSquarePlus size={14} strokeWidth={1.8} aria-hidden />
                </button>
              ),
              renderAnnotation: (annotation: DiffLineAnnotation<NoteSlot>) => {
                const { note } = annotation.metadata;
                if (note !== null) {
                  return (
                    <p className="fm-line-note fm-line-note--saved">
                      <span>Note: {note.note}</span>
                    </p>
                  );
                }
                if (draft === null) return null;
                return (
                  <LineNoteEditor
                    label={lineLabel(draft.path, draft.line)}
                    onCancel={closeDraft}
                    onAdd={(text) => {
                      addLineNote(threadId, {
                        id: randomUUID(),
                        path: draft.path,
                        line: draft.line,
                        removed: draft.side === "deletions",
                        note: text,
                      });
                      closeDraft();
                    }}
                  />
                );
              },
            })}
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
          ...(lineNotes === undefined
            ? {}
            : {
                enableGutterUtility: true,
                // Only the note button picks a line; dragging over code stays plain reading.
                enableLineSelection: false,
                onGutterUtilityClick: (
                  range: SelectedLineRange | null,
                  context: { readonly item: { readonly id: string; readonly type: string } },
                ) => {
                  if (range === null || context.item.type !== "diff") return;
                  const file = files.find((candidate) => candidate.id === context.item.id);
                  if (file === undefined) return;
                  setDraft({
                    itemId: file.id,
                    path: file.path,
                    side: (range.endSide ?? range.side) === "deletions" ? "deletions" : "additions",
                    line: range.end,
                  });
                },
              }),
        }}
      />
    </div>
  );
}
