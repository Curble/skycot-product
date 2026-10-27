// A live thumbnail of a page a child made: the file as it is now, drawn at a quarter of its
// size in a frame with no scripts at all (`sandbox=""`) and the same offline policy as "Open
// it". The engine sends the page with its own stylesheets and pictures already inside it
// (`/api/skycot/family/fridge/page`), because the frame may not load anything, not even from
// SKYCOT. It is read only once the magnet scrolls into view, so a full fridge stays light.
// When the engine has drawn a picture card for the page (`cardHash`), that static picture is
// shown instead; if it cannot be read, or the page takes over five seconds, the magnet shows
// its kind's icon rather than "Getting it ready…" for ever.
import { CircleHelp, FileText, Gamepad2, Gift, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useOfflinePreviewDocument } from "../starters/preview";
import { cardImageSource, cardMatColor } from "./cardText";
import { readMagnetCard, type MagnetCard } from "./cards";
import { fridgeIcon } from "./fridge";
import { readMagnetPage, type MagnetPage } from "./pages";

/** How long "Getting it ready…" may stay before the kind's icon takes its place. */
export const READY_TIMEOUT_MS = 5000;

const KIND_ICONS: Record<ReturnType<typeof fridgeIcon>, LucideIcon> = {
  "questionmark.square.fill": CircleHelp,
  "gift.fill": Gift,
  "gamecontroller.fill": Gamepad2,
  "doc.richtext.fill": FileText,
};

export function MagnetThumb({
  threadId,
  page,
  version,
  title,
  thumbnailSvg,
  cardHash,
  calm = false,
}: {
  readonly threadId: string;
  readonly page: string;
  /** When the page last changed, so a newer version is fetched again. */
  readonly version: number | string;
  readonly title: string;
  readonly thumbnailSvg?: string;
  /** The engine's picture card for this page; a different hash is a different card. */
  readonly cardHash?: string;
  /** While the page is not ready, show the kind's icon rather than the words (the recap). */
  readonly calm?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly page: MagnetPage } | null>(
    null,
  );
  const key = `${threadId}\n${page}\n${version}`;
  const [card, setCard] = useState<{
    readonly hash: string;
    readonly card: MagnetCard;
  } | null>(null);
  const [slowKey, setSlowKey] = useState<string | null>(null);
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
    if (!seen || !cardHash) return;
    let live = true;
    void readMagnetCard(cardHash).then((result) => {
      if (live) setCard({ hash: cardHash, card: result });
    });
    return () => {
      live = false;
    };
  }, [seen, cardHash]);
  const cardAnswer = cardHash !== undefined && card?.hash === cardHash ? card.card : null;
  // Without a card, or once it could not be read, the page itself is drawn as before.
  const cardWaiting = cardHash !== undefined && cardAnswer === null;
  const useCard = cardAnswer?.kind === "card";
  const drawPage = !useCard && !cardWaiting;
  useEffect(() => {
    if (!seen || thumbnailSvg || !drawPage) return;
    let live = true;
    void readMagnetPage({ threadId, page, version }).then((result) => {
      if (live) setLoaded({ key, page: result });
    });
    return () => {
      live = false;
    };
  }, [seen, key, threadId, page, version, thumbnailSvg, drawPage]);
  const current = loaded?.key === key ? loaded.page : null;
  const sealedDocument = useOfflinePreviewDocument(current?.kind === "page" ? current.html : "");
  const waiting =
    !useCard &&
    !cardWaiting &&
    !thumbnailSvg &&
    current?.kind !== "page" &&
    current?.kind !== "gone";
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setSlowKey(key), READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [waiting, key]);
  const KindIcon = KIND_ICONS[fridgeIcon(title, page)];
  return (
    <div ref={ref} className="fm-magnet__thumb" aria-hidden>
      {useCard ? (
        <img
          className="fm-magnet__card"
          alt=""
          loading="lazy"
          src={cardImageSource(cardAnswer.svg)}
          style={{ background: cardMatColor(cardAnswer.svg) ?? undefined }}
        />
      ) : cardWaiting ? (
        <span className="fm-magnet__calm" data-card-waiting="" />
      ) : thumbnailSvg ? (
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
          {current?.kind === "gone" ? (
            "This one isn't here now"
          ) : slowKey === key || calm ? (
            <KindIcon size={32} aria-hidden data-kind-icon="" />
          ) : (
            "Getting it ready…"
          )}
        </span>
      )}
    </div>
  );
}
