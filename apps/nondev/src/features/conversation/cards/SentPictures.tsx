// The pictures a person sent with a message (a child's drawing, a photo of a sketch), shown
// small in their bubble like Messages does; tapping one opens it large. The engine keeps the
// file and hands out a short-lived address for it, so nothing is copied into the page.
import { useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { AssetResource, ChatAttachment, EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { ImageIcon } from "lucide-react";
import { useState } from "react";

import { assetEnvironment } from "../../../state/assets";
import { environmentSession } from "../../../state/session";
import { Button } from "../../../ui/Button";
import { Sheet } from "../../../ui/Sheet";

type ImageAttachment = Extract<ChatAttachment, { readonly type: "image" }>;

export function imagesOf(attachments: ReadonlyArray<ChatAttachment>): Array<ImageAttachment> {
  return attachments.filter(
    (attachment): attachment is ImageAttachment => attachment.type === "image",
  );
}

export function SentPictures({
  environmentId,
  pictures,
}: {
  readonly environmentId: EnvironmentId;
  readonly pictures: ReadonlyArray<ImageAttachment>;
}) {
  const resources: ReadonlyArray<AssetResource> = pictures.map((picture) => ({
    _tag: "attachment",
    attachmentId: picture.id,
    mimeType: picture.mimeType,
    disposition: "inline",
  }));
  const results = useAtomValue(assetEnvironment.createUrls({ environmentId, resources }));
  const connection = useAtomValue(environmentSession.preparedConnectionValueAtom(environmentId));
  const base = Option.isSome(connection) ? connection.value.httpBaseUrl : null;
  const [open, setOpen] = useState<number | null>(null);

  const urls = results.map((result) =>
    base !== null && AsyncResult.isSuccess(result)
      ? resolveAssetUrl(base, result.value.relativeUrl)
      : null,
  );
  const label = (index: number) =>
    pictures.length === 1 ? "Your picture" : `Your picture ${index + 1} of ${pictures.length}`;
  const openUrl = open === null ? null : (urls[open] ?? null);

  return (
    <>
      <span className="fm-bubble-pictures">
        {pictures.map((picture, index) => (
          <button
            key={picture.id}
            type="button"
            className="fm-bubble-pictures__thumb"
            aria-label={`${label(index)}: open it big`}
            onClick={() => setOpen(index)}
            disabled={urls[index] === null}
          >
            {urls[index] ? (
              <img src={urls[index]} alt="" loading="lazy" decoding="async" draggable={false} />
            ) : (
              <ImageIcon size={22} strokeWidth={1.75} aria-hidden />
            )}
          </button>
        ))}
      </span>
      <Sheet
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open === null ? "Your picture" : label(open)}
        wide
        actions={<Button onClick={() => setOpen(null)}>Done</Button>}
      >
        {openUrl ? (
          <img
            className="fm-bubble-pictures__large"
            src={openUrl}
            alt={open === null ? "" : label(open)}
          />
        ) : null}
      </Sheet>
    </>
  );
}
