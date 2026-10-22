// "SKYCOT is asleep": the calm full-screen moment a child sees at bedtime, when today's time
// or messages run out, or when the AI allowance is down to the grown-ups' share. The engine has
// already stopped new turns; this screen only says so kindly and offers the grown-up's way
// round: the parent code, then 15 or 30 more minutes, or bedtime over for tonight. Everything
// happens inside the screen (no sheet on top), and the code prompt is sober in every theme.
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "../../ui/Button";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { useModal } from "../../ui/useModal";
import { Mascot } from "../brand/Mascot";
import type { FamilyChild } from "../family/children";
import { ParentCodeEntry, useParentCodeEntry } from "../family/ParentCodeEntry";
import { asleepCopy, type LimitState } from "./limits";
import { giveMoreTime } from "./store";

type Kind = "extra15" | "extra30" | "endBedtime";

export function AsleepScreen({
  child,
  state,
  timeZone,
  now,
  onSomeoneElse,
}: {
  readonly child: FamilyChild;
  readonly state: LimitState;
  readonly timeZone: string;
  readonly now: number;
  /** Shown when there is more than one child. */
  readonly onSomeoneElse: (() => void) | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);
  // Focus lands on the screen itself: nothing is pressed for the child by accident.
  useModal(ref, { open: true, onClose: () => setAsking(false), initialFocus: "body" });
  const copy = asleepCopy(state, child.limits, child.name, now, timeZone);

  return createPortal(
    <div
      ref={ref}
      className="fm-family-cover fm-asleep"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fm-asleep-title"
      aria-describedby="fm-asleep-body"
      tabIndex={-1}
    >
      <div className="fm-asleep__inner">
        <span className="fm-asleep__art">
          <Mascot pose="night-night" size={176} label="asleep" />
        </span>
        <h1 id="fm-asleep-title" className="fm-asleep__title">
          {copy.title}
        </h1>
        <p id="fm-asleep-body" className="fm-asleep__body">
          {copy.body}
        </p>
        {asking ? (
          <MoreTimePanel
            child={child}
            bedtime={state.reason === "bedtime"}
            onCancel={() => setAsking(false)}
          />
        ) : (
          <div className="fm-asleep__actions">
            <Button variant="primary" onClick={() => setAsking(true)}>
              Ask a grown-up for more time
            </Button>
            {onSomeoneElse ? <Button onClick={onSomeoneElse}>Someone else?</Button> : null}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function MoreTimePanel({
  child,
  bedtime,
  onCancel,
}: {
  readonly child: FamilyChild;
  readonly bedtime: boolean;
  readonly onCancel: () => void;
}) {
  const [kind, setKind] = useState<Kind>("extra15");
  const entry = useParentCodeEntry(
    (code) => giveMoreTime({ childId: child.id, kind, code }),
    () => undefined,
  );
  return (
    <div className="fm-asleep__grownup" data-sober="">
      <p className="fm-asleep__grownup-lead">For a grown-up: how much more?</p>
      <SegmentedControl
        label="More time"
        block
        wrap
        value={kind}
        onChange={setKind}
        options={[
          { value: "extra15", label: "15 minutes" },
          { value: "extra30", label: "30 minutes" },
          ...(bedtime ? [{ value: "endBedtime" as const, label: "No bedtime tonight" }] : []),
        ]}
      />
      <ParentCodeEntry entry={entry} autoFocus />
      <div className="fm-asleep__actions">
        <Button onClick={onCancel} disabled={entry.busy}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!entry.canSubmit} onClick={() => void entry.submit()}>
          {entry.busy ? "Checking…" : "Wake SKYCOT"}
        </Button>
      </div>
      <p className="fm-help">Every bit of extra time shows in Settings › Family.</p>
    </div>
  );
}
