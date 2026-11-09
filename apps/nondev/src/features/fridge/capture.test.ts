// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const callEngine = vi.hoisted(() => vi.fn());
vi.mock("../family/api", () => ({ callEngine, FAMILY_API_PATH: "/api/skycot/family" }));
vi.mock("../../app/platform", () => ({ isElectron: true }));
vi.mock("./store", () => ({ refreshFridge: vi.fn(async () => {}) }));

import {
  CAPTURING_ATTRIBUTE,
  captureMagnetPicture,
  pixelsLookBlank,
  resetCaptureMemory,
} from "./capture";

const item = (extra: object = {}) => ({
  threadId: "t1",
  projectId: "p",
  title: "Game",
  childId: null,
  madeAt: 1,
  page: "game.html",
  cwd: "/x",
  pinnedAt: null,
  contentHash: "h1",
  ...extra,
});
const listed = (items: ReadonlyArray<object>) => ({ ok: true, json: async () => ({ items }) });
const frame = () => {
  const node = document.createElement("iframe");
  document.body.append(node);
  node.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 200 }) as DOMRect;
  return node;
};

let captureRegion: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetCaptureMemory();
  captureRegion = vi.fn(async () => ({ pngBase64: "AAAA" }));
  vi.stubGlobal("desktopBridge", { captureRegion });
  Object.defineProperty(window, "desktopBridge", {
    value: { captureRegion },
    configurable: true,
  });
  vi.spyOn(console, "debug").mockImplementation(() => {});
});
afterEach(() => {
  callEngine.mockReset();
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "desktopBridge");
});

describe("fridge picture capture", () => {
  it("captures the frame once per version of the page and sends it to the engine", async () => {
    callEngine.mockImplementation(async (method: string) =>
      method === "GET" ? listed([item()]) : { ok: true },
    );
    const node = frame();
    expect(
      await captureMagnetPicture({
        source: { kind: "frame", frame: node },
        threadId: "t1",
        page: "game.html",
      }),
    ).toBe(true);
    expect(captureRegion).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      width: 300,
      height: 200,
      maxWidth: 640,
    });
    expect(callEngine).toHaveBeenLastCalledWith("POST", "/api/skycot/family/fridge/picture", {
      threadId: "t1",
      page: "game.html",
      contentHash: "h1",
      pngBase64: "AAAA",
    });
    expect(
      await captureMagnetPicture({
        source: { kind: "frame", frame: node },
        threadId: "t1",
        page: "game.html",
      }),
    ).toBe(false);
    expect(captureRegion).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the magnet already has its picture or the page has no magnet", async () => {
    callEngine.mockResolvedValue(listed([item({ hasPicture: true })]));
    expect(
      await captureMagnetPicture({
        source: { kind: "frame", frame: frame() },
        threadId: "t1",
        page: "game.html",
      }),
    ).toBe(false);
    expect(
      await captureMagnetPicture({
        source: { kind: "frame", frame: frame() },
        threadId: "other",
        page: "game.html",
      }),
    ).toBe(false);
    expect(captureRegion).not.toHaveBeenCalled();
  });

  it("stays quiet when the engine refuses, and tries again next time", async () => {
    callEngine.mockImplementation(async (method: string) =>
      method === "GET" ? listed([item()]) : { ok: false },
    );
    const node = frame();
    expect(
      await captureMagnetPicture({
        source: { kind: "frame", frame: node },
        threadId: "t1",
        page: "game.html",
      }),
    ).toBe(false);
    expect(
      await captureMagnetPicture({
        source: { kind: "frame", frame: node },
        threadId: "t1",
        page: "game.html",
      }),
    ).toBe(false);
    expect(captureRegion).toHaveBeenCalledTimes(2);
  });

  it("captures the Preview pane's tab through the preview bridge, once per version", async () => {
    const capturePicture = vi.fn(async () => ({ pngBase64: "BBBB" }));
    Object.defineProperty(window, "desktopBridge", {
      value: { preview: { capturePicture } },
      configurable: true,
    });
    callEngine.mockImplementation(async (method: string) =>
      method === "GET" ? listed([item()]) : { ok: true },
    );
    const input = {
      source: { kind: "tab", tabId: "tab-1" },
      threadId: "t1",
      page: "game.html",
    } as const;
    expect(await captureMagnetPicture(input)).toBe(true);
    expect(capturePicture).toHaveBeenCalledWith("tab-1", 640);
    expect(callEngine).toHaveBeenLastCalledWith("POST", "/api/skycot/family/fridge/picture", {
      threadId: "t1",
      page: "game.html",
      contentHash: "h1",
      pngBase64: "BBBB",
    });
    expect(await captureMagnetPicture(input)).toBe(false);
    expect(capturePicture).toHaveBeenCalledTimes(1);
    // A new version of the page (new hash) gets a fresh picture.
    callEngine.mockImplementation(async (method: string) =>
      method === "GET" ? listed([item({ contentHash: "h2" })]) : { ok: true },
    );
    expect(await captureMagnetPicture(input)).toBe(true);
    expect(capturePicture).toHaveBeenCalledTimes(2);
  });

  it("does nothing for a tab when the bridge has no picture method or it fails", async () => {
    Object.defineProperty(window, "desktopBridge", { value: { preview: {} }, configurable: true });
    const input = {
      source: { kind: "tab", tabId: "tab-1" },
      threadId: "t1",
      page: "game.html",
    } as const;
    expect(await captureMagnetPicture(input)).toBe(false);
    const capturePicture = vi.fn(async () => null);
    Object.defineProperty(window, "desktopBridge", {
      value: { preview: { capturePicture } },
      configurable: true,
    });
    callEngine.mockImplementation(async (method: string) =>
      method === "GET" ? listed([item()]) : { ok: true },
    );
    expect(await captureMagnetPicture(input)).toBe(false);
    expect(await captureMagnetPicture(input)).toBe(false);
    expect(capturePicture).toHaveBeenCalledTimes(2);
  });
});

describe("loadedPageMatches", () => {
  it("treats the folder root as index.html and otherwise compares file names", async () => {
    const { loadedPageMatches } = await import("./capture");
    expect(loadedPageMatches("http://127.0.0.1:4123/", "index.html")).toBe(true);
    expect(loadedPageMatches("http://127.0.0.1:4123/index.html", "index.html")).toBe(true);
    expect(loadedPageMatches("http://127.0.0.1:4123/pages/my-game.html", "my-game.html")).toBe(
      true,
    );
    expect(loadedPageMatches("http://127.0.0.1:4123/other.html", "index.html")).toBe(false);
    expect(loadedPageMatches("not a url", "index.html")).toBe(false);
  });
});

describe("pageFileName", () => {
  it("treats a folder or root as index.html and decodes names", async () => {
    const { pageFileName } = await import("./capture");
    expect(pageFileName("/")).toBe("index.html");
    expect(pageFileName("")).toBe("index.html");
    expect(pageFileName("index.html")).toBe("index.html");
    expect(pageFileName("/pages/my%20game.html")).toBe("my game.html");
  });
});

describe("a blank picture is not a picture", () => {
  const filled = (count: number, rgb: readonly [number, number, number]) => {
    const pixels = new Uint8ClampedArray(count * 4);
    for (let index = 0; index < count; index += 1) pixels.set([...rgb, 255], index * 4);
    return pixels;
  };

  it("calls one flat colour blank, even with a sliver of something else", () => {
    const white = filled(4096, [255, 255, 255]);
    expect(pixelsLookBlank(white)).toBe(true);
    // A soft shadow or a few stray pixels (under 1.5%) is still nothing to look at.
    for (let index = 0; index < 40; index += 1) white.set([30, 30, 30, 255], index * 4);
    expect(pixelsLookBlank(white)).toBe(true);
    expect(pixelsLookBlank(new Uint8ClampedArray(0))).toBe(true);
  });

  it("keeps a start screen: a flat background with a title and a button on it", () => {
    const screen = filled(4096, [12, 16, 48]);
    for (let index = 0; index < 300; index += 1) screen.set([255, 255, 255, 255], index * 4);
    expect(pixelsLookBlank(screen)).toBe(false);
  });

  it("keeps SKYCOT's own buttons out of the frame's picture while it is taken", async () => {
    callEngine.mockImplementation(async (method: string) =>
      method === "GET" ? listed([item()]) : { ok: true },
    );
    let during: boolean | null = null;
    captureRegion.mockImplementation(async () => {
      during = document.documentElement.hasAttribute(CAPTURING_ATTRIBUTE);
      return { pngBase64: "AAAA" };
    });
    expect(
      await captureMagnetPicture({
        source: { kind: "frame", frame: frame() },
        threadId: "t1",
        page: "game.html",
      }),
    ).toBe(true);
    expect(during).toBe(true);
    expect(document.documentElement.hasAttribute(CAPTURING_ATTRIBUTE)).toBe(false);
  });

  it("looks again when the page had drawn nothing, and keeps nothing if it stays blank", async () => {
    vi.useFakeTimers();
    callEngine.mockImplementation(async (method: string) =>
      method === "GET" ? listed([item()]) : { ok: true },
    );
    // Every picture decodes to a flat white square.
    vi.stubGlobal("createImageBitmap", async () => ({ width: 64, height: 64, close() {} }));
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          drawImage() {},
          getImageData: () => ({ data: filled(4096, [255, 255, 255]) }),
        }) as unknown as CanvasRenderingContext2D,
    );
    const result = captureMagnetPicture({
      source: { kind: "frame", frame: frame() },
      threadId: "t1",
      page: "game.html",
    });
    await vi.runAllTimersAsync();
    expect(await result).toBe(false);
    expect(captureRegion).toHaveBeenCalledTimes(3);
    expect(callEngine).not.toHaveBeenCalledWith(
      "POST",
      "/api/skycot/family/fridge/picture",
      expect.anything(),
    );
    getContext.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
