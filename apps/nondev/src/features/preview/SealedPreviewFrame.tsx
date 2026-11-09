import { useState, type Ref } from "react";

import { PREVIEW_SANDBOX } from "../starters/preview";

/**
 * The sealed, offline frame for one page. The frame is made only once its page is ready, and a
 * new page gets a new frame. Swapping the page inside a frame that already exists (even an
 * empty one that has not been drawn yet) starts the new page with a screen 0 wide and 0 tall:
 * a game that measures its canvas as it starts then draws nothing until "Start again".
 */
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
  // Counts the pages this frame has been given, so each one gets a frame of its own.
  const [shown, setShown] = useState({ srcDoc, count: 0 });
  if (shown.srcDoc !== srcDoc) setShown({ srcDoc, count: shown.count + 1 });
  if (srcDoc === "") return null;
  return (
    <iframe
      key={shown.count}
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
