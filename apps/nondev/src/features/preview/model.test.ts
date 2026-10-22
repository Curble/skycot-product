import { describe, expect, it } from "vite-plus/test";

import {
  colorName,
  describePickedElement,
  fixItMessage,
  parsePreviewStatus,
  pointerFor,
  previewSurface,
  shortAddress,
  type PickedElement,
} from "./model";

const command = { runner: "npm run dev", script: "node server.js" };
const mac = { hostname: "localhost", origin: "http://localhost:3773" };
const SITE = "http://localhost:5173/";

describe("parsePreviewStatus", () => {
  it("reads every state the engine sends", () => {
    expect(parsePreviewStatus({ state: "no-site" })).toEqual({ state: "no-site" });
    expect(
      parsePreviewStatus({
        state: "ready",
        command,
        decision: { kind: "grown-up", reasons: ["installs something", 4] },
        requestId: "skycot-preview:abc",
      }),
    ).toEqual({
      state: "ready",
      command,
      decision: { kind: "grown-up", reasons: ["installs something"] },
      requestId: "skycot-preview:abc",
    });
    expect(
      parsePreviewStatus({
        state: "running",
        command,
        url: "http://localhost:5173/",
        frameable: false,
      }),
    ).toEqual({ state: "running", command, url: "http://localhost:5173/", frameable: false });
  });

  it("never draws an address that is not on this Mac, whatever the answer says", () => {
    expect(
      parsePreviewStatus({ state: "running", command, url: "https://example.com/" }),
    ).toBeNull();
    expect(parsePreviewStatus({ error: "needs-approval" })).toBeNull();
    expect(parsePreviewStatus("<html>")).toBeNull();
  });
});

describe("previewSurface", () => {
  it("uses the Mac app's own preview browser when there is one", () => {
    expect(
      previewSurface({ hasDesktopPreview: true, page: mac, url: SITE, frameable: false }),
    ).toBe("desktop");
  });

  it("frames the site in a browser on this Mac, unless the site forbids it", () => {
    expect(
      previewSurface({ hasDesktopPreview: false, page: mac, url: SITE, frameable: true }),
    ).toBe("frame");
    expect(
      previewSurface({ hasDesktopPreview: false, page: mac, url: SITE, frameable: false }),
    ).toBe("outside");
  });

  it("knows a phone cannot reach the Mac's own address", () => {
    expect(
      previewSurface({
        hasDesktopPreview: false,
        page: {
          hostname: "marks-mac.tail1234.ts.net",
          origin: "https://marks-mac.tail1234.ts.net",
        },
        url: SITE,
        frameable: true,
      }),
    ).toBe("elsewhere");
  });

  it("never frames SKYCOT's own address", () => {
    expect(
      previewSurface({
        hasDesktopPreview: false,
        page: mac,
        url: "http://localhost:3773/simple/",
        frameable: true,
      }),
    ).toBe("outside");
  });
});

describe("words", () => {
  it("shortens the address for the toolbar", () => {
    expect(shortAddress("http://localhost:5173/")).toBe("localhost:5173");
    expect(shortAddress("http://localhost:5173/games/")).toBe("localhost:5173/games/");
  });

  it("prefills a message that hands Sam what the start printed", () => {
    const message = fixItMessage({
      state: "failed",
      command,
      reason: "exited",
      output: "Error: Cannot find module 'server.js'",
    });
    expect(message).toContain("The preview didn't start.");
    expect(message).toContain("`npm run dev`");
    expect(message).toContain("Error: Cannot find module 'server.js'");
  });
});

describe("describePickedElement", () => {
  const picked = (overrides: Partial<PickedElement>): PickedElement => ({
    tagName: "h1",
    htmlPreview: "<h1>Welcome to my pet page</h1>",
    styles: "",
    selector: "main > h1",
    pageUrl: "http://localhost:5173/",
    rect: { width: 600, height: 60 },
    ...overrides,
  });

  it("says what a child would: size, colour and what it is", () => {
    expect(
      describePickedElement(
        picked({
          styles: "className: title\n\ncolor: rgb(255, 105, 180);\nfont-size: 56px;",
        }),
      ),
    ).toBe("the big pink title “Welcome to my pet page”");
  });

  it("leaves out plain black text and shortens long words", () => {
    expect(
      describePickedElement(
        picked({
          tagName: "p",
          htmlPreview: "<p>My cat is called Biscuit and she likes naps in the sun</p>",
          styles: "color: rgb(29, 29, 31);",
        }),
      ),
    ).toBe("the text “My cat is called Biscuit and…”");
  });

  it("names a button by its fill and a picture without quoting it", () => {
    expect(
      describePickedElement(
        picked({
          tagName: "button",
          htmlPreview: '<button style="background-color: #34c759">Feed me</button>',
          styles: "color: rgb(255, 255, 255);",
        }),
      ),
    ).toBe("the green button “Feed me”");
    expect(
      describePickedElement(
        picked({
          tagName: "img",
          htmlPreview: '<img src="cat.png" alt="cat">',
          rect: { width: 500, height: 400 },
        }),
      ),
    ).toBe("the big picture");
  });

  it("falls back to a plain part for anything else", () => {
    expect(
      describePickedElement(
        picked({ tagName: "div", htmlPreview: "<div></div>", rect: { width: 20, height: 20 } }),
      ),
    ).toBe("the part");
  });

  it("hands the assistant the element itself", () => {
    expect(pointerFor(picked({ tagName: "H1" }))).toMatchObject({
      tagName: "h1",
      selector: "main > h1",
      pageUrl: "http://localhost:5173/",
    });
  });

  it("names colours plainly", () => {
    expect(colorName([0, 113, 227])).toBe("blue");
    expect(colorName([255, 59, 48])).toBe("red");
    expect(colorName([255, 204, 0])).toBe("yellow");
    expect(colorName([142, 68, 236])).toBe("purple");
    expect(colorName([120, 120, 120])).toBe("grey");
    expect(colorName([250, 250, 250])).toBe("white");
  });
});
