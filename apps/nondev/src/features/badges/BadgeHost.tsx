// Mounted once beside the Family limits host: keeps this device's sticker book fresh (when
// the child here changes, when SKYCOT goes to sleep or wakes, when the window comes back),
// and lets a new sticker arrive with one celebration when nothing more important is on screen.
import type { BadgeId } from "@t3tools/skycot-rules/badges";
import { useEffect, useEffectEvent, useState } from "react";

import { STICKERS_HREF, navigate, useRoute } from "../../router";
import { useFamily } from "../family/FamilyProvider";
import { useLimits } from "../family-limits/store";
import { canCelebrateNow, isFirstStickerArrival } from "./canCelebrate";
import { BADGE_COPY } from "./catalog";
import { StickerArrives } from "./StickerArrives";
import { Sticker } from "./stickers/Sticker";
import { markBadgesSeen, refreshBadges, unseenBadges, useBadges } from "./store";
import "./badges.css";

/** How long a waiting sticker waits before looking again (a card or a sheet was up). */
const RETRY_MS = 4_000;
const FIRST_PAUSE_MS = 900;

export function BadgeHost() {
  const family = useFamily();
  const limits = useLimits();
  const route = useRoute();
  const { book } = useBadges();
  const childKey = family.enabled ? (family.profile.currentChildId ?? "none") : "solo";
  const sleep = limits.session?.limits;
  const sleepKey = sleep ? `${sleep.asleep}:${sleep.reason ?? ""}` : "";

  // Bedtime starting or ending is also when "Good night" is judged (on the engine).
  useEffect(() => {
    void refreshBadges();
  }, [
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Another child here, or SKYCOT falling asleep or waking, means a fresh look at the book.
    childKey,
    sleepKey,
  ]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshBadges();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Stickers already mentioned by a celebration ("one more is waiting in your book") wait
  // there, still new, instead of popping up one after another.
  const [announced, setAnnounced] = useState<ReadonlySet<BadgeId>>(() => new Set());
  const unseen = unseenBadges(book).filter((id) => !announced.has(id));
  const onBookPage = route.name === "stickers" || route.name === "certificate";
  const asleep = sleep?.asleep === true;
  const [showing, setShowing] = useState<ReadonlyArray<BadgeId> | null>(null);
  const [toast, setToast] = useState<BadgeId | null>(null);
  const [tick, setTick] = useState(0);
  const waiting = showing === null && unseen.length > 0 && !onBookPage && !asleep;

  // A short pause first lets the moment that earned it land (the What-changed card, the
  // message going out); then again every few seconds while something needs the child.
  const tryToShow = useEffectEvent(() => {
    if (canCelebrateNow()) {
      const earnedBefore =
        book?.badges.some((badge) => badge.earned !== null && badge.earned.seen) ?? false;
      if (!isFirstStickerArrival(unseen, earnedBefore)) setToast(unseen[0] ?? null);
      else setShowing(unseen);
    } else setTick((value) => value + 1);
  });
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(tryToShow, tick === 0 ? FIRST_PAUSE_MS : RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [waiting, tick, book]);

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => {
      void markBadgesSeen([toast]);
      setToast(null);
    }, 7_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (toast !== null) {
    return (
      <button
        className="fm-sticker-toast"
        type="button"
        aria-label={`${BADGE_COPY[toast].title} sticker. Open your sticker book.`}
        onClick={() => {
          void markBadgesSeen([toast]);
          setToast(null);
          navigate(STICKERS_HREF);
        }}
      >
        <Sticker id={toast} size={48} label={`${BADGE_COPY[toast].title} sticker`} />
        <span>{BADGE_COPY[toast].title}</span>
      </button>
    );
  }
  if (showing === null || showing.length === 0) return null;
  return (
    <StickerArrives
      ids={showing}
      onDone={() => {
        void markBadgesSeen(showing.slice(0, 1));
        setAnnounced(new Set([...announced, ...showing.slice(1)]));
        setShowing(null);
      }}
    />
  );
}
