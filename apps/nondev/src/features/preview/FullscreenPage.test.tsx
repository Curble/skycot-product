// @effect-diagnostics nodeBuiltinImport:off - jsdom does not load CSS, so this test reads its style rule.
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ child: false }));
vi.mock("../../app/useChildView", () => ({ useChildView: () => state.child }));

import { FullscreenPage } from "./FullscreenPage";
import { BrowserPreviewFrame } from "./BrowserPreviewFrame";
import { PREVIEW_SANDBOX } from "../starters/preview";
import { DesktopPreviewFrame } from "./DesktopPreviewFrame";
import { SealedPreviewFrame } from "./SealedPreviewFrame";
import type { DesktopPreviewBridge, EnvironmentId } from "@t3tools/contracts";

async function mount(game: boolean) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<FullscreenPage game={game}>Page</FullscreenPage>));
  return {
    host,
    async click(selector: string) {
      const button = host.querySelector<HTMLButtonElement>(selector);
      if (!button) throw new Error(`No button found for ${selector}`);
      await act(async () => {
        button.focus();
        button.click();
      });
    },
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  state.child = false;
  Reflect.deleteProperty(window, "desktopBridge");
  vi.unstubAllGlobals();
});

describe("page fullscreen control", () => {
  it("keeps the Family notice below the fullscreen exit pill", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(window, "desktopBridge", {
      configurable: true,
      value: {
        getWindowFullscreenState: () => true,
        onWindowFullscreenStateChange: () => () => {},
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <div className="fm-shell" data-columns="1">
          <FullscreenPage game>
            <div className="fm-preview__notice">Stay here</div>
            <h1 className="fm-conv-header__name">Preview a very long project title</h1>
          </FullscreenPage>
        </div>,
      ),
    );
    host.querySelector(".fm-fullscreen-page")!.classList.add("is-fullscreen");
    const notice = host.querySelector<HTMLElement>(".fm-preview__notice");
    expect(notice).not.toBeNull();
    expect(notice!.closest(".fm-fullscreen-page.is-fullscreen")).not.toBeNull();
    const styles = readFileSync("apps/nondev/src/styles/preview.css", "utf8");
    const noticeStyle = styles.match(
      /\.fm-fullscreen-page\.is-fullscreen\s+\.fm-preview__notice\s*\{([^}]+)\}/,
    )?.[1];
    expect(noticeStyle).toMatch(/position:\s*absolute/);
    expect(noticeStyle).toMatch(/top:\s*max\(58px,/);
    const headerStyles = readFileSync("apps/nondev/src/styles/shell.css", "utf8");
    const titleStyle = headerStyles.match(
      /\.fm-shell\[data-columns="1"\] \.fm-conv-header__name\s*\{([^}]+)\}/,
    )?.[1];
    expect(titleStyle).toMatch(/text-overflow:\s*ellipsis/);
    expect(titleStyle).toMatch(/white-space:\s*nowrap/);
    expect(titleStyle).toMatch(/overflow-wrap:\s*normal/);
    await act(async () => root.unmount());
    host.remove();
  });

  it("allows fullscreen in the browser frame and keeps the sealed sandbox unchanged", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(<BrowserPreviewFrame url="http://127.0.0.1:5100/" onControls={() => {}} />),
    );
    expect(host.querySelector("iframe")?.getAttribute("allow")).toBe("fullscreen");
    expect(PREVIEW_SANDBOX).toBe("allow-scripts allow-modals allow-forms");
    await act(async () => root.unmount());
    host.remove();

    const sealedHost = document.createElement("div");
    document.body.append(sealedHost);
    const sealedRoot = createRoot(sealedHost);
    await act(async () =>
      sealedRoot.render(
        <SealedPreviewFrame
          frameRef={() => {}}
          className="sealed"
          title="Sealed page"
          srcDoc="<!doctype html>"
          onLoad={() => {}}
        />,
      ),
    );
    const sealedFrame = sealedHost.querySelector("iframe");
    expect(sealedFrame?.getAttribute("allow")).toBe("fullscreen");
    expect(sealedFrame?.getAttribute("sandbox")).toBe(PREVIEW_SANDBOX);
    await act(async () => sealedRoot.unmount());
    sealedHost.remove();

    const desktopHost = document.createElement("div");
    document.body.append(desktopHost);
    const desktopRoot = createRoot(desktopHost);
    const bridge = {
      createTab: async () => {},
      getPreviewConfig: async () => ({
        partition: "preview",
        webPreferences: "",
        preloadUrl: null,
      }),
      setAnnotationTheme: async () => {},
      onStateChange: () => () => {},
      onOpenLink: () => () => {},
    } as unknown as DesktopPreviewBridge;
    await act(async () =>
      desktopRoot.render(
        <DesktopPreviewFrame
          bridge={bridge}
          environmentId={"env" as EnvironmentId}
          url="http://127.0.0.1:5100/"
          onControls={() => {}}
          onNavigated={() => {}}
          onOpenLink={() => {}}
        />,
      ),
    );
    expect(desktopHost.querySelector("webview")?.hasAttribute("allowfullscreen")).toBe(true);
    await act(async () => desktopRoot.unmount());
    desktopHost.remove();
  });

  it("uses the game label only for a child playing a game", async () => {
    state.child = true;
    const game = await mount(true);
    expect(game.host.textContent).toContain("Play full screen");
    await game.unmount();

    const page = await mount(false);
    expect(page.host.textContent).toContain("Full screen");
    await page.unmount();

    state.child = false;
    const grownUpGame = await mount(true);
    expect(grownUpGame.host.textContent).toContain("Full screen");
    await grownUpGame.unmount();
  });

  it("leaves fullscreen from Escape and the visible exit control", async () => {
    const onState = vi.fn();
    const setWindowFullscreen = vi.fn(async () => {});
    Object.defineProperty(window, "desktopBridge", {
      configurable: true,
      value: {
        getWindowFullscreenState: () => false,
        onWindowFullscreenStateChange: (listener: (value: boolean) => void) => {
          onState.mockImplementation(listener);
          return () => {};
        },
        setWindowFullscreen,
      },
    });
    const page = await mount(true);
    await page.click(".fm-fullscreen-page__enter button");
    expect(setWindowFullscreen).toHaveBeenCalledWith(true);
    await act(async () => onState(true));
    expect(page.host.textContent).toContain("Exit full screen");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(setWindowFullscreen).toHaveBeenLastCalledWith(false);
    await act(async () => onState(false));
    await page.click(".fm-fullscreen-page__enter button");
    await act(async () => onState(true));
    await page.click(".fm-fullscreen-page__exit");
    expect(setWindowFullscreen).toHaveBeenLastCalledWith(false);
    await page.unmount();
  });
});
