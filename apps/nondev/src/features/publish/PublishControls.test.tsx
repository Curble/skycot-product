// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const createNote = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("../family/api", () => ({ familyApi: { createNote } }));

import { ShowGrownUpButton } from "./PublishControls";

afterEach(() => {
  createNote.mockClear();
});

describe("ShowGrownUpButton", () => {
  it("asks before sending the whole conversation and its pictures", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(<ShowGrownUpButton threadId="thread-1" title="My game" includesPictures />),
    );
    await act(async () => host.querySelector("button")!.click());
    expect(document.body.textContent).toContain(
      "Send this whole conversation (and its pictures, if any) to a grown-up?",
    );
    expect(document.body.textContent).toContain("with its pictures");
    expect(document.body.textContent).toContain("Not now");
    expect(createNote).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    host.remove();
  });
});
