// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

import { useOfflinePreviewDocument } from "../starters/preview";
import { SealedPreviewFrame } from "./SealedPreviewFrame";

// A page swapped into a frame that already exists starts 0 wide and 0 tall, so a game that
// measures its canvas as it starts draws nothing until "Start again" (the fridge's first open).
describe("SealedPreviewFrame", () => {
  it("makes no frame until the page is ready, and a new frame for each page", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const show = (srcDoc: string) =>
      act(async () =>
        root.render(
          <SealedPreviewFrame
            frameRef={() => {}}
            className="sealed"
            title="Sealed page"
            srcDoc={srcDoc}
            onLoad={() => {}}
          />,
        ),
      );

    await show("");
    expect(host.querySelector("iframe")).toBeNull();

    await show("<!doctype html><p>one</p>");
    const first = host.querySelector("iframe");
    expect(first?.getAttribute("srcdoc")).toBe("<!doctype html><p>one</p>");

    await show("<!doctype html><p>one</p>");
    expect(host.querySelector("iframe")).toBe(first);

    await show("<!doctype html><p>two</p>");
    const second = host.querySelector("iframe");
    expect(second).not.toBe(first);
    expect(second?.getAttribute("srcdoc")).toBe("<!doctype html><p>two</p>");

    await act(async () => root.unmount());
    host.remove();
  });
});

describe("useOfflinePreviewDocument", () => {
  it("answers nothing until the document is for the page asked about", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const seen: Array<string> = [];
    function Probe({ html }: { readonly html: string }) {
      seen.push(useOfflinePreviewDocument(html));
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    const settle = () => act(async () => new Promise<void>((done) => setTimeout(done, 0)));

    await act(async () => root.render(<Probe html="" />));
    await settle();
    expect(new Set(seen)).toEqual(new Set([""]));

    seen.length = 0;
    await act(async () => root.render(<Probe html="<p>one</p>" />));
    await settle();
    expect(seen.at(-1)).toContain("<p>one</p>");
    // Never the empty page's wrapper on the way there: only nothing, then the page.
    expect(seen.every((value) => value === "" || value.includes("<p>one</p>"))).toBe(true);

    seen.length = 0;
    await act(async () => root.render(<Probe html="<p>two</p>" />));
    await settle();
    expect(seen.at(-1)).toContain("<p>two</p>");
    expect(seen.some((value) => value.includes("<p>one</p>"))).toBe(false);

    await act(async () => root.unmount());
  });
});
