// The family fridge (`#/fridge`): everything each child has made, one magnet per conversation
// that made a page. Children see their own shelf and their siblings'; pinning and taking down
// need no code; nothing leaves the Mac and nothing is deleted. Without the Family profile it is
// one shelf of everything made here.
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { enabledEnvironmentIdsAtom } from "../../state/catalog";
import { useColumns } from "../../app/useColumns";
import { Banner } from "../../ui/Banner";
import { EmptyState } from "../../ui/EmptyState";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Mascot } from "../brand/Mascot";
import { ChildAvatar } from "../family/ChildAvatar";
import { childLabel, type FamilyChild } from "../family/children";
import { useFamily } from "../family/FamilyProvider";
import { PreviewSheet } from "../starters/PreviewSheet";
import { fridgeShelves, type FridgeItem } from "./fridge";
import { FridgeIcon } from "./FridgeIcon";
import { FridgeMagnet } from "./FridgeMagnet";
import { pinMagnet, refreshFridge, useFridge } from "./store";
import "./fridge.css";

// "Made today" only changes at midnight; a coarse clock is plenty.
const readHour = () => Math.floor(Date.now() / 3_600_000) * 3_600_000;
const subscribeHour = (onChange: () => void) => {
  const timer = window.setInterval(onChange, 3_600_000);
  return () => window.clearInterval(timer);
};

export function useHourClock(): number {
  return useSyncExternalStore(subscribeHour, readHour, readHour);
}

export function FridgeScreen() {
  const family = useFamily();
  const fridge = useFridge();
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const environmentId = environmentIds[0] ?? null;
  const columns = useColumns();
  const now = useHourClock();
  const [only, setOnly] = useState<string>("everyone");
  const [open, setOpen] = useState<FridgeItem | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void refreshFridge();
  }, []);

  const children = family.enabled ? family.profile.children : [];
  const nameOf = (childId: string | null) => {
    const index = children.findIndex((child) => child.id === childId);
    return index < 0 ? null : childLabel(children[index]!, index);
  };
  const shelves = fridgeShelves(
    fridge.items,
    children.map((child) => child.id),
    only === "everyone" ? null : only,
  );
  const pin = (item: FridgeItem, pinned: boolean) =>
    void pinMagnet(item.threadId, pinned).then(setProblem);

  return (
    <div className="fm-home fm-fridge">
      <div className="fm-home__inner fm-fridge__inner">
        <div className="fm-screen-head">
          <div className="fm-fridge__head">
            <span className="fm-fridge__glyph" aria-hidden>
              <FridgeIcon size={26} />
            </span>
            <div>
              <h2 className="fm-home__greeting">
                <span className="fm-marker-underline">The fridge</span>
              </h2>
              <p className="fm-home__sub">
                {children.length > 1
                  ? "Everything everyone made, on this Mac. Pin the best ones up top."
                  : "Everything made here, on this Mac. Pin the best ones up top."}{" "}
                Taking one down never deletes it.
              </p>
            </div>
          </div>
        </div>
        {children.length > 1 ? (
          <div className="fm-fridge__filter">
            <SegmentedControl
              label="Whose fridge"
              size="sm"
              wrap={columns === 1}
              value={only}
              onChange={setOnly}
              options={[
                { value: "everyone", label: "Everyone" },
                ...children.map((child, index) => ({
                  value: child.id,
                  label: childLabel(child, index),
                })),
              ]}
            />
          </div>
        ) : null}
        {problem ? <Banner tone="warning">{problem}</Banner> : null}
        {fridge.problem && fridge.items.length === 0 ? (
          <Banner tone="warning">{fridge.problem}</Banner>
        ) : null}
        {!fridge.loaded ? (
          <p className="fm-help">Opening the fridge…</p>
        ) : fridge.items.length === 0 && !fridge.problem ? (
          <EmptyState
            art={<Mascot pose="hello" size={88} decorative />}
            title="Nothing on the fridge yet"
          >
            When a conversation makes a page — a game, a card, a poster — it shows up here.
          </EmptyState>
        ) : (
          shelves.map((shelf) => {
            const child = children.find((candidate) => candidate.id === shelf.childId) ?? null;
            const name = nameOf(shelf.childId);
            return (
              <section key={shelf.childId ?? "others"} className="fm-fridge__shelf">
                <ShelfHeading
                  child={child}
                  name={name}
                  count={shelf.items.length}
                  several={children.length > 1}
                />
                {shelf.items.length === 0 ? (
                  <p className="fm-help fm-fridge__empty">
                    Nothing on {name ? `${name}'s` : "this"} fridge yet. Pages {name ?? "they"} make
                    show up here.
                  </p>
                ) : (
                  <div className="fm-fridge__grid">
                    {shelf.items.map((item, index) => (
                      <FridgeMagnet
                        key={item.threadId}
                        item={item}
                        index={index}
                        environmentId={environmentId}
                        now={now}
                        maker={only === "everyone" && children.length > 1 ? name : null}
                        onOpen={() => setOpen(item)}
                        onPin={(pinned) => pin(item, pinned)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })
        )}
        <p className="fm-help fm-fridge__foot">
          The fridge is kept on this Mac. SKYCOT doesn't upload or share anything on it.
        </p>
      </div>
      {open !== null && environmentId !== null ? (
        <PreviewSheet
          open
          onClose={() => setOpen(null)}
          environmentId={environmentId}
          cwd={open.cwd}
          relativePath={open.page}
        />
      ) : null}
    </div>
  );
}

function ShelfHeading({
  child,
  name,
  count,
  several,
}: {
  readonly child: FamilyChild | null;
  readonly name: string | null;
  readonly count: number;
  readonly several: boolean;
}) {
  const title =
    child === null
      ? several
        ? "Made before the Family profile"
        : "Everything made here"
      : `${name}'s fridge`;
  return (
    <h3 className="fm-fridge__shelf-title">
      {child ? <ChildAvatar child={child} size={28} /> : null}
      <span>{title}</span>
      <small>{count === 1 ? "1 thing" : `${count} things`}</small>
    </h3>
  );
}
