import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../voice/browser", () => ({ useVoiceSettings: () => ({ typing: false }) }));
vi.mock("../voice/VoiceTyping", () => ({
  useVoiceTypingControl: () => ({ cancel: () => {} }),
  MicButton: () => null,
  VoiceTypingStatus: () => null,
}));

import { MessageField } from "./MessageField";

async function mount(starterBlanks: boolean, onSend: (text: string) => void, addPictures = false) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Composer() {
    const [text, setText] = useState("Make a card for [nickname] who is [age].");
    return (
      <MessageField
        value={text}
        onChange={setText}
        onSend={() => onSend(text)}
        placeholder="Your idea"
        canSend
        starterBlanks={starterBlanks}
        {...(addPictures ? { onAddPictures: () => {} } : {})}
      />
    );
  }
  await act(async () => root.render(<Composer />));
  const field = host.querySelector("textarea")!;
  return {
    host,
    field,
    async type(text: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          field,
          text,
        );
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    async send() {
      await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='Send']")!.click());
    },
    async [Symbol.asyncDispose]() {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    },
  };
}

describe("starter blanks in the message box", () => {
  it("labels the picture button in words as well as for assistive technology", async () => {
    await using page = await mount(false, vi.fn(), true);
    const button = page.host.querySelector(".fm-composer__attach");
    expect(button?.textContent).toContain("Add a picture");
    expect(button?.getAttribute("aria-label")).toBe("Add a picture");
  });

  it("keeps the words, highlights a remaining blank and sends only once it is filled or removed", async () => {
    const sent = vi.fn();
    await using page = await mount(true, sent);
    await page.type("Make a card for Nan who is [age].");
    await page.send();
    expect(sent).not.toHaveBeenCalled();
    expect(page.field.value).toBe("Make a card for Nan who is [age].");
    expect(page.host.textContent).toContain("Fill in the [age] bit, or delete it.");
    expect(page.field.value.slice(page.field.selectionStart, page.field.selectionEnd)).toBe(
      "[age]",
    );
    await page.type("Make a card for Nan.");
    await page.send();
    expect(sent).toHaveBeenCalledWith("Make a card for Nan.");
  });

  it("selects the next blank after a replacement is typed, rather than after its first letter", async () => {
    await using page = await mount(true, vi.fn());
    vi.useFakeTimers();
    try {
      page.field.focus();
      await page.type("Make a card for N who is [age].");
      await act(async () => vi.advanceTimersByTime(400));
      await page.type("Make a card for Nan who is [age].");
      await act(async () => vi.advanceTimersByTime(899));
      expect(page.field.selectionStart).toBe(page.field.selectionEnd);
      await act(async () => vi.advanceTimersByTime(1));
      expect(page.field.value.slice(page.field.selectionStart, page.field.selectionEnd)).toBe(
        "[age]",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves ordinary messages and grown-up starters free to send brackets", async () => {
    const sent = vi.fn();
    await using page = await mount(false, sent);
    await page.send();
    expect(sent).toHaveBeenCalledWith("Make a card for [nickname] who is [age].");
  });
});
