import type { Ref } from "react";

import { PREVIEW_SANDBOX } from "../starters/preview";

export function SealedPreviewFrame({
  frameRef,
  className,
  title,
  srcDoc,
  onLoad,
}: {
  readonly frameRef: Ref<HTMLIFrameElement>;
  readonly className: string;
  readonly title: string;
  readonly srcDoc: string;
  readonly onLoad: () => void;
}) {
  return (
    <iframe
      ref={frameRef}
      className={className}
      title={title}
      sandbox={PREVIEW_SANDBOX}
      allow="fullscreen"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      onLoad={onLoad}
    />
  );
}
