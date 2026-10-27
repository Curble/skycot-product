// Pictures added to a message ("Draw it, then build it", or the + button): which files are
// accepted, and the upload shape the engine stores with the message. Big phone photos are
// shrunk to the 2000 px edge first: Claude refuses larger images once a thread holds many,
// and a child's drawing needs nothing bigger.
import {
  downscalableImageMimeType,
  fitImageAttachmentSize,
} from "@t3tools/client-runtime/image-attachment-size";
import {
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type UploadChatImageAttachment,
} from "@t3tools/contracts";

export const MAX_PICTURES = 4;
export const PICTURE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const ACCEPTED: ReadonlySet<string> = new Set(PICTURE_ACCEPT.split(","));

/** Images pasted into the message box use the same small, supported set as file selection. */
export function picturesFromClipboard(
  items: Iterable<Pick<DataTransferItem, "kind" | "type" | "getAsFile">>,
): ReadonlyArray<File> {
  const pictures: Array<File> = [];
  for (const item of items) {
    if (item.kind !== "file" || !ACCEPTED.has(item.type.toLowerCase())) continue;
    const file = item.getAsFile();
    if (file !== null) pictures.push(file);
  }
  return pictures;
}

export interface PictureDraft {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly dataUrl: string;
}

export interface PictureFileLike {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

/** Which of the chosen files to take, and one plain sentence about any left out. */
export function choosePictures(
  files: ReadonlyArray<PictureFileLike>,
  alreadyAdded: number,
): { readonly accepted: ReadonlyArray<number>; readonly problem: string | null } {
  const accepted: Array<number> = [];
  let wrongKind = 0;
  let tooBig = 0;
  let overLimit = 0;
  files.forEach((file, index) => {
    if (!ACCEPTED.has(file.type.toLowerCase())) wrongKind += 1;
    else if (file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) tooBig += 1;
    else if (alreadyAdded + accepted.length >= MAX_PICTURES) overLimit += 1;
    else accepted.push(index);
  });
  const problem =
    wrongKind > 0
      ? "That file isn't a picture SKYCOT can use. Try a PNG or JPEG photo."
      : tooBig > 0
        ? "That picture is too big (over 10 MB). Try a smaller photo."
        : overLimit > 0
          ? `Up to ${MAX_PICTURES} pictures per message.`
          : null;
  return { accepted, problem };
}

export function toUploadAttachment(picture: PictureDraft): UploadChatImageAttachment {
  return {
    type: "image",
    name: picture.name,
    mimeType: picture.mimeType,
    sizeBytes: picture.sizeBytes,
    dataUrl: picture.dataUrl,
  };
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("Couldn't read the picture.")),
    );
    reader.readAsDataURL(blob);
  });
}

/** Reads one picture, shrinking a PNG or JPEG past the size limit. */
export async function readPicture(file: File, id: string): Promise<PictureDraft> {
  const downscaleType = downscalableImageMimeType(file.type);
  if (downscaleType !== null && typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const fitted = fitImageAttachmentSize({ width: bitmap.width, height: bitmap.height });
      if (fitted !== null) {
        const canvas = document.createElement("canvas");
        canvas.width = fitted.width;
        canvas.height = fitted.height;
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0, fitted.width, fitted.height);
        bitmap.close();
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, downscaleType, 0.9),
        );
        if (blob !== null) {
          return {
            id,
            name: file.name,
            mimeType: downscaleType,
            sizeBytes: blob.size,
            dataUrl: await readAsDataUrl(blob),
          };
        }
      } else {
        bitmap.close();
      }
    } catch {
      // Not decodable here: send it as it is and let the engine decide.
    }
  }
  return {
    id,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    dataUrl: await readAsDataUrl(file),
  };
}
