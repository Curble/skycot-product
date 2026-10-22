// A live thumbnail of a page a child made: the file as it is now, drawn at a quarter of its
// size in a frame with no scripts at all (`sandbox=""`) and the same offline policy as "Open
// it". It is read only once the magnet scrolls into view, so a full fridge stays light.
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useEnvironmentQuery } from "~/state/query";

import { projectEnvironment } from "../../state/projects";
import { offlinePreviewDocument } from "../starters/preview";

export function MagnetThumb({
  environmentId,
  cwd,
  page,
  title,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string;
  readonly page: string;
  readonly title: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
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
  const file = useEnvironmentQuery(
    seen && environmentId !== null
      ? projectEnvironment.readFile({ environmentId, input: { cwd, relativePath: page } })
      : null,
  );
  const contents = file.data && file.data.exists !== false ? file.data.contents : null;
  return (
    <div ref={ref} className="fm-magnet__thumb" aria-hidden>
      {contents !== null ? (
        <iframe
          className="fm-magnet__frame"
          title={`Picture of ${title}`}
          sandbox=""
          tabIndex={-1}
          loading="lazy"
          referrerPolicy="no-referrer"
          srcDoc={offlinePreviewDocument(contents)}
        />
      ) : (
        <span className="fm-magnet__placeholder">
          {file.data?.exists === false ? "Not there any more" : ""}
        </span>
      )}
    </div>
  );
}
