// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const callEngine = vi.hoisted(() => vi.fn());
vi.mock("../family/api", () => ({ callEngine, FAMILY_API_PATH: "/api/skycot/family" }));
vi.mock("../../app/platform", () => ({ isElectron: true }));
vi.mock("./store", () => ({ refreshFridge: vi.fn(async () => {}) }));

import { captureMagnetPicture, resetCaptureMemory } from "./capture";

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
    expect(await captureMagnetPicture({ frame: node, threadId: "t1", page: "game.html" })).toBe(
      true,
    );
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
    expect(await captureMagnetPicture({ frame: node, threadId: "t1", page: "game.html" })).toBe(
      false,
    );
    expect(captureRegion).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the magnet already has its picture or the page has no magnet", async () => {
    callEngine.mockResolvedValue(listed([item({ hasPicture: true })]));
    expect(await captureMagnetPicture({ frame: frame(), threadId: "t1", page: "game.html" })).toBe(
      false,
    );
    expect(
      await captureMagnetPicture({ frame: frame(), threadId: "other", page: "game.html" }),
    ).toBe(false);
    expect(captureRegion).not.toHaveBeenCalled();
  });

  it("stays quiet when the engine refuses, and tries again next time", async () => {
    callEngine.mockImplementation(async (method: string) =>
      method === "GET" ? listed([item()]) : { ok: false },
    );
    const node = frame();
    expect(await captureMagnetPicture({ frame: node, threadId: "t1", page: "game.html" })).toBe(
      false,
    );
    expect(await captureMagnetPicture({ frame: node, threadId: "t1", page: "game.html" })).toBe(
      false,
    );
    expect(captureRegion).toHaveBeenCalledTimes(2);
  });
});
