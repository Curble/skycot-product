// The one celebration: a new sticker slaps onto the screen, SKYCOT cheers, and confetti falls
// once if the theme is playful and the person allows motion. Everything animates once and
// then sits still (CSS, fill-mode forwards); under Reduce motion the card simply appears.
// Several stickers at once show the first and say how many more are in the book.
import type { BadgeId } from "@t3tools/skycot-rules/badges";
import { useRef } from "react";
import { createPortal } from "react-dom";

import { STICKERS_HREF, navigate } from "../../router";
import { ConfettiBurst } from "../../themes/Confetti";
import { Button } from "../../ui/Button";
import { useModal } from "../../ui/useModal";
import { Mascot } from "../brand/Mascot";
import { BADGE_COPY } from "./catalog";
import { Sticker } from "./stickers/Sticker";

export function StickerArrives({
  ids,
  onDone,
}: {
  readonly ids: ReadonlyArray<BadgeId>;
  readonly onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, { open: true, onClose: onDone, initialFocus: "first" });
  const first = ids[0]!;
  const copy = BADGE_COPY[first];
  const more = ids.length - 1;

  return createPortal(
    <div className="fm-arrive-backdrop" onClick={onDone}>
      <div
        ref={ref}
        className="fm-arrive"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fm-arrive-title"
        aria-describedby="fm-arrive-cheer"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <ConfettiBurst />
        <span className="fm-arrive__sticker">
          <Sticker id={first} size={184} label={`${copy.title} sticker`} />
        </span>
        <span className="fm-arrive__mascot">
          <Mascot pose="yay" size={72} decorative />
        </span>
        <p className="fm-arrive__kicker">You found a sticker!</p>
        <h2 id="fm-arrive-title" className="fm-arrive__title">
          {copy.title}
        </h2>
        <p id="fm-arrive-cheer" className="fm-arrive__cheer">
          {copy.cheer}
        </p>
        {more > 0 ? (
          <p className="fm-arrive__more">
            {more === 1
              ? "And one more new sticker is waiting in your book."
              : `And ${more} more new stickers are waiting in your book.`}
          </p>
        ) : null}
        <div className="fm-arrive__actions">
          <Button variant="primary" onClick={onDone}>
            Yay!
          </Button>
          <Button
            onClick={() => {
              onDone();
              navigate(STICKERS_HREF);
            }}
          >
            See my sticker book
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
