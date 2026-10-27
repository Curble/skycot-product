import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const callEngine = vi.hoisted(() => vi.fn());
vi.mock("../family/api", () => ({ callEngine, FAMILY_API_PATH: "/api/skycot/family" }));
vi.mock("../starters/preview", () => ({ useOfflinePreviewDocument: () => "" }));
vi.mock("./pages", () => ({ readMagnetPage: () => new Promise(() => {}) }));

import { cardImageSource, cardMatColor, parseMagnetCard } from "./cardText";
import { readMagnetCard } from "./cards";
import { MagnetThumb, READY_TIMEOUT_MS } from "./MagnetThumb";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
const answer = (text: string, status = 200) => ({
  ok: status === 200,
  text: async () => text,
});

afterEach(() => {
  callEngine.mockReset();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

async function show(props: { cardHash?: string }) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <MagnetThumb
        threadId="t1"
        page="index.html"
        version="v1"
        title="My game"
        {...(props.cardHash === undefined ? {} : { cardHash: props.cardHash })}
      />,
    ),
  );
  return host;
}

describe("fridge picture cards", () => {
  it("reads the card as text and never as something to run", async () => {
    callEngine.mockResolvedValue(answer(SVG));
    const card = await readMagnetCard("hash-text");
    expect(card).toEqual({ kind: "card", svg: SVG });
    expect(callEngine).toHaveBeenCalledWith("GET", "/api/skycot/family/fridge/card", undefined, {
      hash: "hash-text",
    });
    // Shown only as an image address: an image never runs the script inside it.
    expect(cardImageSource(SVG).startsWith("data:image/svg+xml;")).toBe(true);
    expect(document.querySelector("script")).toBeNull();
  });

  it("mats the tile in the card's own colour, and only a plain colour", () => {
    expect(cardMatColor('<svg><rect width="320" height="180" rx="20" fill="#5b7cfa"/></svg>')).toBe(
      "#5b7cfa",
    );
    expect(cardMatColor('<svg><rect fill="url(#x)"/></svg>')).toBeNull();
    expect(cardMatColor("<svg></svg>")).toBeNull();
  });

  it("refuses an answer that is not an SVG picture", () => {
    expect(parseMagnetCard("<html><script>x</script></html>")).toBeNull();
    expect(parseMagnetCard('<?xml version="1.0"?><svg></svg>')).not.toBeNull();
  });

  it("renders the card as an image when the item has a cardHash", async () => {
    callEngine.mockResolvedValue(answer("<svg>card one</svg>"));
    const host = await show({ cardHash: "hash-render" });
    const img = host.querySelector("img");
    expect(img?.getAttribute("src")).toContain(encodeURIComponent("card one"));
    expect(host.querySelector("iframe")).toBeNull();
  });

  it("falls back to the page drawing when there is no cardHash", async () => {
    const host = await show({});
    expect(callEngine).not.toHaveBeenCalled();
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("Getting it ready…");
  });

  it("swaps 'Getting it ready…' for the kind's icon after five seconds", async () => {
    vi.useFakeTimers();
    const host = await show({});
    expect(host.textContent).toContain("Getting it ready…");
    await act(async () => {
      vi.advanceTimersByTime(READY_TIMEOUT_MS + 10);
    });
    expect(host.textContent).not.toContain("Getting it ready…");
    expect(host.querySelector("[data-kind-icon]")).not.toBeNull();
  });
});
