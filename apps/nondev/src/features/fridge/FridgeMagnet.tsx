// One magnet: a live thumbnail of the page, its title, when it was made and by whom, and the
// crew's sticker. Tapping the picture opens it with "Open it" (running, offline). Pinning and
// taking it down are free for everyone; neither touches the page.
import { Pin, PinOff, Play } from "lucide-react";
import type { CSSProperties } from "react";

import { CrewAvatar } from "../../themes/CrewAvatar";
import { Button } from "../../ui/Button";
import { displayTitle } from "../tidy/renamedTitles";
import { madeLabel, type FridgeItem } from "./fridge";
import { MagnetThumb } from "./MagnetThumb";

/** A small, stable tilt per magnet, so a sticky-note fridge never looks machine-aligned. */
function tiltOf(threadId: string): number {
  let hash = 0;
  for (const char of threadId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return ((Math.abs(hash) % 5) - 2) * 0.8;
}

export function FridgeMagnet({
  item,
  now,
  maker,
  index,
  compact = false,
  onOpen,
  onPin,
}: {
  readonly item: FridgeItem;
  readonly now: number;
  /** "Ava", or null when nobody is known to have made it. */
  readonly maker: string | null;
  /** Position on the shelf: picks the note colour in sticky-note looks. */
  readonly index: number;
  readonly compact?: boolean;
  readonly onOpen: () => void;
  readonly onPin?: (pinned: boolean) => void;
}) {
  const pinned = item.pinnedAt !== null;
  const title = displayTitle(item.threadId, item.title);
  return (
    <article
      className={`fm-magnet${compact ? " fm-magnet--compact" : ""}`}
      data-pinned={pinned ? "" : undefined}
      data-note={index % 4}
      style={{ "--fm-magnet-tilt": `${tiltOf(item.threadId)}deg` } as CSSProperties}
      aria-label={title}
    >
      <span className="fm-magnet__magnet" aria-hidden />
      <button
        type="button"
        className="fm-magnet__open"
        onClick={onOpen}
        aria-label={`Open ${title}`}
      >
        <MagnetThumb
          threadId={item.threadId}
          page={item.page}
          version={item.contentHash ?? String(item.madeAt)}
          title={title}
        />
      </button>
      <div className="fm-magnet__meta">
        <b className="fm-magnet__title">{title}</b>
        <small className="fm-magnet__when">
          {madeLabel(item.madeAt, now)}
          {maker ? ` · by ${maker}` : ""}
        </small>
      </div>
      <span className="fm-magnet__sticker" aria-hidden>
        <CrewAvatar role="builder" size="sm" />
      </span>
      {compact || onPin === undefined ? null : (
        <div className="fm-magnet__actions">
          <Button size="sm" icon={Play} onClick={onOpen}>
            Open it
          </Button>
          <Button
            size="sm"
            variant="quiet"
            icon={pinned ? PinOff : Pin}
            onClick={() => onPin(!pinned)}
            aria-pressed={pinned}
          >
            {pinned ? "Take it down" : "Pin to the fridge"}
          </Button>
        </div>
      )}
    </article>
  );
}
