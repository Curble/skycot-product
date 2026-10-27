import { describe, expect, it, vi } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";

import { ReviewActions } from "./ReviewSection";

describe("ReviewSection actions in the child view", () => {
  it("uses the short keep, go back and change labels", () => {
    const html = renderToStaticMarkup(
      <ReviewActions
        childView
        hasPage
        keepDisabled={false}
        keeping={false}
        kept={false}
        canUndo
        undoNoteId="undo-note"
        undoBlocker={null}
        onPlay={vi.fn()}
        onKeep={vi.fn()}
        onUndo={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    expect(html).toContain("Play it");
    expect(html).toContain("Keep it");
    expect(html).toContain("Go back");
    expect(html).toContain("Change something");
    expect(html).not.toContain("Git");
    expect(html).not.toContain("Ask for a tweak");
  });

  it("shows Keeping… and Kept ✓ in the child view", () => {
    const render = (keeping: boolean, kept: boolean) =>
      renderToStaticMarkup(
        <ReviewActions
          childView
          hasPage
          keepDisabled={keeping || kept}
          keeping={keeping}
          kept={kept}
          canUndo
          undoNoteId="undo-note"
          undoBlocker={null}
          onPlay={vi.fn()}
          onKeep={vi.fn()}
          onUndo={vi.fn()}
          onChange={vi.fn()}
        />,
      );
    expect(render(true, false)).toContain("Keeping…");
    const done = render(false, true);
    expect(done).toContain("Kept ✓");
    expect(done).not.toContain("Keep it");
  });
});
