// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const seen = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));

vi.mock("~/components/diffs/StyledDiffCodeView", () => ({
  StyledDiffCodeView: (props: Record<string, unknown>) => {
    seen.props = props;
    return null;
  },
}));
vi.mock("~/lib/diffRendering", () => ({
  fnv1a32: (text: string) => text.length,
  getRenderablePatch: () => ({
    kind: "files",
    files: [{ name: "index.html" }],
  }),
  resolveDiffThemeName: () => "light",
  resolveFileDiffPath: (file: { name: string }) => file.name,
}));
vi.mock("~/lib/syntaxHighlighting", () => ({ PREFERRED_HIGHLIGHTER: "shiki-js" }));

import CodeChanges from "./CodeChanges";
import { clearLineNotes } from "../linecomment/notes";

function mount(lineNotes?: { threadId: string }) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<CodeChanges diff="d" scope="s" {...(lineNotes ? { lineNotes } : {})} />));
  return { host, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  clearLineNotes("t1");
  seen.props = null;
  document.body.replaceChildren();
});

describe("CodeChanges line notes", () => {
  it("offers nothing when notes are not allowed (a child, or Family on)", () => {
    const view = mount();
    const options = seen.props!.options as Record<string, unknown>;
    expect(seen.props!.renderGutterUtility).toBeUndefined();
    expect(seen.props!.renderAnnotation).toBeUndefined();
    expect(options.onGutterUtilityClick).toBeUndefined();
    expect(options.enableGutterUtility).toBeUndefined();
    view.unmount();
  });

  it("hooks the viewer's gutter button when allowed, and opens a note box on a click", () => {
    const view = mount({ threadId: "t1" });
    const options = seen.props!.options as {
      onGutterUtilityClick: (range: unknown, context: unknown) => void;
      enableGutterUtility: boolean;
    };
    expect(options.enableGutterUtility).toBe(true);
    act(() =>
      options.onGutterUtilityClick(
        { start: 7, end: 7, side: "additions" },
        { item: { id: "s:0", type: "diff" } },
      ),
    );
    const items = seen.props!.items as Array<{ annotations: Array<{ lineNumber: number }> }>;
    expect(items[0]!.annotations.map((a) => a.lineNumber)).toEqual([7]);
    view.unmount();
  });
});
