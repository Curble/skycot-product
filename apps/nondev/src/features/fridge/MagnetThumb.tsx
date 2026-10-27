// A live thumbnail of a page a child made: the file as it is now, drawn at a quarter of its
// size in a frame with no scripts at all (`sandbox=""`) and the same offline policy as "Open
// it". The engine sends the page with its own stylesheets and pictures already inside it
// (`/api/skycot/family/fridge/page`), because the frame may not load anything, not even from
// SKYCOT. It is read only once the magnet scrolls into view, so a full fridge stays light.
import { useEffect, useRef, useState } from "react";

import { useOfflinePreviewDocument } from "../starters/preview";
import { readMagnetPage, type MagnetPage } from "./pages";

export function MagnetThumb({
  threadId,
  page,
  version,
  title,
  thumbnailSvg,
}: {
  readonly threadId: string;
  readonly page: string;
  /** When the page last changed, so a newer version is fetched again. */
  readonly version: number | string;
  readonly title: string;
  readonly thumbnailSvg?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly page: MagnetPage } | null>(
    null,
  );
  const key = `${threadId}\n${page}\n${version}`;
  useEffect(() => {
    const node = ref.current;
    if (node === null || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [seen]);
  useEffect(() => {
    if (!seen || thumbnailSvg) return;
    let live = true;
    void readMagnetPage({ threadId, page, version }).then((result) => {
      if (live) setLoaded({ key, page: result });
    });
    return () => {
      live = false;
    };
  }, [seen, key, threadId, page, version, thumbnailSvg]);
  const current = loaded?.key === key ? loaded.page : null;
  const sealedDocument = useOfflinePreviewDocument(current?.kind === "page" ? current.html : "");
  return (
    <div ref={ref} className="fm-magnet__thumb" aria-hidden>
      {thumbnailSvg ? (
        <img
          className="fm-magnet__frame"
          alt=""
          loading="lazy"
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(thumbnailSvg)}`}
        />
      ) : current?.kind === "page" ? (
        <iframe
          className="fm-magnet__frame"
          title={`Picture of ${title}`}
          sandbox=""
          tabIndex={-1}
          loading="lazy"
          referrerPolicy="no-referrer"
          srcDoc={sealedDocument}
        />
      ) : (
        <span className="fm-magnet__placeholder">
          {current?.kind === "gone" ? "This one isn't here now" : "Getting it ready…"}
        </span>
      )}
    </div>
  );
}
