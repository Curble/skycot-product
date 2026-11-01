// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { LineNoteChips } from "./LineNoteChips";
import { LineNoteEditor } from "./LineNoteEditor";
import {
  addLineNote,
  clearLineNotes,
  MAX_LINE_NOTES,
  removeLineNote,
  useLineNotes,
  type LineNote,
} from "./notes";

const note = (id: string, line: number): LineNote => ({
  id,
  path: "site/index.html",
  line,
  removed: false,
  note: "Bigger",
});

function mount(node: React.ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, unmount: () => act(() => root.unmount()) };
}

function Chips({ threadId }: { readonly threadId: string }) {
  const notes = useLineNotes(threadId);
  return <LineNoteChips threadId={threadId} notes={notes} disabled={false} />;
}

afterEach(() => {
  clearLineNotes("t1");
  document.body.replaceChildren();
});

describe("LineNoteChips", () => {
  it("shows nothing without notes, then one chip per note with the count", () => {
    const view = mount(<Chips threadId="t1" />);
    expect(view.host.querySelector("ul")).toBeNull();
    act(() => addLineNote("t1", note("a", 12)));
    act(() => addLineNote("t1", note("b", 40)));
    expect(view.host.querySelector("ul")?.getAttribute("aria-label")).toBe("2 notes on the code");
    expect(view.host.textContent).toContain("Note on index.html line 12");
    expect(view.host.textContent).toContain("Note on index.html line 40");
    view.unmount();
  });

  it("removes a note with its x", () => {
    const view = mount(<Chips threadId="t1" />);
    act(() => addLineNote("t1", note("a", 12)));
    act(() => addLineNote("t1", note("b", 40)));
    const remove = view.host.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove: Note on index.html line 12"]',
    )!;
    act(() => remove.click());
    expect(view.host.textContent).not.toContain("line 12");
    expect(view.host.textContent).toContain("line 40");
    view.unmount();
  });
});

describe("LineNoteEditor", () => {
  const type = (field: HTMLTextAreaElement, value: string) => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      set.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("asks what should change and adds the trimmed note", () => {
    const onAdd = vi.fn();
    const view = mount(
      <LineNoteEditor label="index.html line 3" onAdd={onAdd} onCancel={vi.fn()} />,
    );
    const field = view.host.querySelector("textarea")!;
    expect(field.placeholder).toBe("What should change here?");
    const add = [...view.host.querySelectorAll("button")].find(
      (b) => b.textContent === "Add note",
    )!;
    expect(add.disabled).toBe(true);
    type(field, "  Use blue  ");
    expect(add.disabled).toBe(false);
    act(() => add.click());
    expect(onAdd).toHaveBeenCalledWith("Use blue");
    view.unmount();
  });

  it("Escape and Cancel both cancel", () => {
    const onCancel = vi.fn();
    const view = mount(<LineNoteEditor label="x line 1" onAdd={vi.fn()} onCancel={onCancel} />);
    const field = view.host.querySelector("textarea")!;
    act(() => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    const cancel = [...view.host.querySelectorAll("button")].find(
      (b) => b.textContent === "Cancel",
    )!;
    act(() => cancel.click());
    expect(onCancel).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});

describe("notes waiting for the next message", () => {
  function Ids({ threadId }: { readonly threadId: string }) {
    return (
      <p data-testid={threadId}>
        {useLineNotes(threadId)
          .map((entry) => entry.id)
          .join(",")}
      </p>
    );
  }
  const ids = (host: HTMLElement, threadId: string) =>
    host.querySelector(`[data-testid="${threadId}"]`)!.textContent;

  it("add, remove and clear, per conversation", () => {
    const view = mount(
      <>
        <Ids threadId="t1" />
        <Ids threadId="t2" />
      </>,
    );
    act(() => addLineNote("t1", note("a", 1)));
    act(() => addLineNote("t1", note("b", 2)));
    act(() => addLineNote("t2", note("c", 3)));
    expect(ids(view.host, "t1")).toBe("a,b");
    expect(ids(view.host, "t2")).toBe("c");
    act(() => removeLineNote("t1", "a"));
    expect(ids(view.host, "t1")).toBe("b");
    // What happens after a successful send.
    act(() => clearLineNotes("t1"));
    expect(ids(view.host, "t1")).toBe("");
    expect(ids(view.host, "t2")).toBe("c");
    act(() => clearLineNotes("t2"));
    view.unmount();
  });

  it("keeps only as many as one message carries", () => {
    const view = mount(<Ids threadId="t1" />);
    for (let i = 0; i < MAX_LINE_NOTES + 3; i += 1) act(() => addLineNote("t1", note(`n${i}`, i)));
    const kept = ids(view.host, "t1")!.split(",");
    expect(kept).toHaveLength(MAX_LINE_NOTES);
    expect(kept.at(-1)).toBe(`n${MAX_LINE_NOTES + 2}`);
    view.unmount();
  });
});
