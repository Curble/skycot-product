import { describe, expect, it } from "vite-plus/test";

import {
  MAX_PICTURES,
  choosePictures,
  picturesFromClipboard,
  toUploadAttachment,
} from "./pictures";

const png = (name: string, size = 1_000) => ({ name, type: "image/png", size });

describe("pictures on a message", () => {
  it("takes PNG, JPEG, WebP and GIF pictures", () => {
    const files = [png("a.png"), { name: "b.jpg", type: "image/jpeg", size: 10 }];
    expect(choosePictures(files, 0)).toEqual({ accepted: [0, 1], problem: null });
  });

  it("leaves out files that are not pictures, and says so plainly", () => {
    const result = choosePictures([{ name: "notes.pdf", type: "application/pdf", size: 10 }], 0);
    expect(result.accepted).toEqual([]);
    expect(result.problem).toMatch(/isn't a picture/);
  });

  it("leaves out pictures over 10 MB", () => {
    const result = choosePictures([png("huge.png", 11 * 1024 * 1024), png("ok.png")], 0);
    expect(result.accepted).toEqual([1]);
    expect(result.problem).toMatch(/too big/);
  });

  it("stops at the per-message limit, counting pictures already added", () => {
    const result = choosePictures([png("1.png"), png("2.png"), png("3.png")], MAX_PICTURES - 1);
    expect(result.accepted).toEqual([0]);
    expect(result.problem).toBe(`Up to ${MAX_PICTURES} pictures per message.`);
  });

  it("takes supported pictures from the clipboard and ignores text and unsupported files", () => {
    const drawing = { name: "drawing.png" } as File;
    const items = [
      { kind: "string", type: "text/plain", getAsFile: () => null },
      { kind: "file", type: "image/png", getAsFile: () => drawing },
      { kind: "file", type: "image/svg+xml", getAsFile: () => ({ name: "page.svg" }) as File },
    ] satisfies Array<Pick<DataTransferItem, "kind" | "type" | "getAsFile">>;
    expect(picturesFromClipboard(items)).toEqual([drawing]);
  });

  it("sends a picture as an image upload, without the draft id", () => {
    expect(
      toUploadAttachment({
        id: "draft-1",
        name: "drawing.png",
        mimeType: "image/png",
        sizeBytes: 3,
        dataUrl: "data:image/png;base64,AAA",
      }),
    ).toEqual({
      type: "image",
      name: "drawing.png",
      mimeType: "image/png",
      sizeBytes: 3,
      dataUrl: "data:image/png;base64,AAA",
    });
  });
});
