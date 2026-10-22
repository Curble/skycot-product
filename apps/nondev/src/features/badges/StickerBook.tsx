// "My sticker book" (#/stickers): one page per child in the Workshop sticker-album look, the
// same in every theme (it is the child's own book, like the mascot is artwork). Stickers found
// sit on the page with the day they arrived; the rest are soft shapes with a plain hint, and a
// "2 of 3" where counting helps. No totals to beat, no "don't lose it": the page only says what
// is there and how to find more.
import type { BadgeId, BadgeView } from "@t3tools/skycot-rules/badges";
import { ChevronLeft, Printer } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { HOME_HREF, certificateHref, navigate } from "../../router";
import { Button, IconButton } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Mascot } from "../brand/Mascot";
import { useFamily } from "../family/FamilyProvider";
import { BADGE_COPY, earnedDate, firstName } from "./catalog";
import { Sticker } from "./stickers/Sticker";
import { markBadgesSeen, refreshBadges, unseenBadges, useBadges } from "./store";

export function StickerBook({ showBack }: { readonly showBack: boolean }) {
  const family = useFamily();
  const { status, book } = useBadges();
  const name = family.enabled ? firstName(family.profile.childName) : null;
  // What was new when the page opened keeps its "New!" while the page is open.
  const [fresh, setFresh] = useState<ReadonlySet<BadgeId> | null>(null);
  const unseen = unseenBadges(book);
  if (fresh === null && book !== null) setFresh(new Set(unseen));
  useEffect(() => {
    void refreshBadges();
  }, []);
  // Opening the book is seeing what arrived, so no celebration follows on another screen.
  const unseenKey = unseen.join(",");
  const markSeen = useEffectEvent(() => void markBadgesSeen(unseen));
  useEffect(() => {
    if (unseenKey.length > 0) markSeen();
  }, [unseenKey]);

  const badges = (book?.badges ?? []).filter(
    (badge) => badge.earned !== null || family.enabled || !BADGE_COPY[badge.id].familyOnly,
  );
  const found = badges.filter((badge) => badge.earned !== null).length;
  const title = name ? `${name}'s sticker book` : "My sticker book";

  return (
    <div className="fm-album-screen">
      <div className="fm-album-screen__inner">
        <header className="fm-album-head">
          {showBack ? (
            <IconButton icon={ChevronLeft} label="Back" onClick={() => navigate(HOME_HREF)} />
          ) : null}
          <div className="fm-album-head__text">
            <h2 className="fm-album-head__title">{title}</h2>
            <p className="fm-album-head__sub">
              {book === null
                ? "Stickers arrive when you make things with SKYCOT."
                : found === 0
                  ? "No stickers yet. Make something and see what you find!"
                  : `${found} found so far. Every sticker comes from something you did.`}
            </p>
          </div>
          <span className="fm-album-head__mascot" aria-hidden>
            <Mascot pose={found > 0 ? "yay" : "hello"} size={72} decorative />
          </span>
        </header>

        {book === null ? (
          <EmptyState
            art={<Mascot pose="thinking" size={72} />}
            title={
              status === "loading"
                ? "Opening your sticker book…"
                : family.enabled
                  ? "Who's using SKYCOT?"
                  : "Your sticker book is resting"
            }
          >
            {status === "loading"
              ? null
              : family.enabled
                ? "Choose who you are first, and your own sticker book opens."
                : "SKYCOT couldn't open the sticker book just now. Try again in a moment."}
          </EmptyState>
        ) : (
          <>
            <section className="fm-album" aria-label="Stickers">
              <span className="fm-album__rings" aria-hidden />
              <ol className="fm-album__grid">
                {badges.map((badge) => (
                  <Slot key={badge.id} badge={badge} fresh={fresh?.has(badge.id) ?? false} />
                ))}
              </ol>
            </section>
            <Certificates badges={badges} />
          </>
        )}
      </div>
    </div>
  );
}

function Slot({ badge, fresh }: { readonly badge: BadgeView; readonly fresh: boolean }) {
  const copy = BADGE_COPY[badge.id];
  if (badge.earned !== null) {
    return (
      <li className="fm-slot fm-slot--found">
        {fresh ? <span className="fm-slot__new">New!</span> : null}
        <Sticker id={badge.id} size={104} label={`${copy.title} sticker`} />
        <b className="fm-slot__title">{copy.title}</b>
        <small className="fm-slot__when">{earnedDate(badge.earned.at)}</small>
      </li>
    );
  }
  return (
    <li className="fm-slot fm-slot--todo">
      <Sticker id={badge.id} size={104} silhouette />
      <b className="fm-slot__title">
        <span className="fm-sr-only">Still to find: </span>
        {copy.title}
      </b>
      <small className="fm-slot__hint">
        {copy.hint}
        {badge.progress ? (
          <span className="fm-slot__count">
            {" "}
            {badge.progress.have} of {badge.progress.need}
          </span>
        ) : null}
      </small>
    </li>
  );
}

function Certificates({ badges }: { readonly badges: ReadonlyArray<BadgeView> }) {
  const first = badges.find((badge) => badge.id === "first-creation")?.earned ?? null;
  const ten = badges.find((badge) => badge.id === "ten")?.earned ?? null;
  if (first === null && ten === null) return null;
  return (
    <section className="fm-album-certs" aria-label="Certificates">
      <h3 className="fm-album-certs__title">Certificates to print</h3>
      <div className="fm-album-certs__row">
        {first ? (
          <CertificateCard
            title="My first app"
            line={first.title ? `“${first.title}”` : "Your very first creation"}
            href={certificateHref("first")}
            sticker="first-creation"
          />
        ) : null}
        {ten ? (
          <CertificateCard
            title="My 10th creation"
            line={ten.title ? `“${ten.title}”` : "Ten things made"}
            href={certificateHref("tenth")}
            sticker="ten"
          />
        ) : null}
      </div>
    </section>
  );
}

function CertificateCard({
  title,
  line,
  href,
  sticker,
}: {
  readonly title: string;
  readonly line: string;
  readonly href: string;
  readonly sticker: BadgeId;
}) {
  return (
    <div className="fm-cert-card">
      <Sticker id={sticker} size={56} />
      <span className="fm-cert-card__text">
        <b>{title}</b>
        <small>{line}</small>
      </span>
      <Button size="sm" icon={Printer} onClick={() => navigate(href)}>
        Print
      </Button>
    </div>
  );
}
