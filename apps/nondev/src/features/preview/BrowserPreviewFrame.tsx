// A browser on this Mac: the site's own address in a frame. The site keeps its own origin (a
// different port is a different origin), so it cannot reach into SKYCOT, and the sandbox stops
// it from taking over the window or opening pop-ups. A frame of another origin cannot be
// scripted, so "Point at something" is the Mac app's (DesktopPreviewFrame).
import { useEffect, useEffectEvent, useState } from "react";

import type { FrameControls } from "./DesktopPreviewFrame";

export function BrowserPreviewFrame({
  url,
  onControls,
}: {
  readonly url: string;
  readonly onControls: (controls: FrameControls | null) => void;
}) {
  const [shown, setShown] = useState({ url, generation: 0 });
  if (shown.url !== url) setShown({ url, generation: shown.generation + 1 });

  const report = useEffectEvent(onControls);
  useEffect(() => {
    report({
      // A new element is the one reload a page of another origin cannot refuse.
      reload: () => setShown((current) => ({ ...current, generation: current.generation + 1 })),
      navigate: (next) =>
        setShown((current) => ({ url: next, generation: current.generation + 1 })),
    });
    return () => report(null);
  }, []);

  return (
    // The site is always another origin than SKYCOT (previewSurface never frames SKYCOT's own),
    // so it keeps its own storage without being able to lift its sandbox or reach the app.
    <iframe
      key={shown.generation}
      className="fm-preview__frame"
      title="Your site"
      src={shown.url}
      allow="fullscreen"
      // oxlint-disable-next-line react/iframe-missing-sandbox -- cross-origin by construction
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-pointer-lock"
      referrerPolicy="no-referrer"
    />
  );
}
