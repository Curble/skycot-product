// "SKYCOT is asleep": the calm full-screen moment a child sees at bedtime, when today's time
// or messages run out, or when the AI allowance is down to the grown-ups' share. The engine has
// already stopped new turns; this screen only says so kindly and offers the grown-up's way
// round: the parent code, then 15 or 30 more minutes, or bedtime over for tonight. Everything
// happens inside the screen (no sheet on top), and the code prompt is sober in every theme.
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { enabledEnvironmentIdsAtom } from "../../state/catalog";

import { Button } from "../../ui/Button";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { useModal } from "../../ui/useModal";
import { Mascot } from "../brand/Mascot";
import type { FamilyChild } from "../family/children";
import { ParentCodeEntry, useParentCodeEntry } from "../family/ParentCodeEntry";
import { tryParentCode } from "../family/store";
import { fetchRecap } from "../recap/api";
import type { RecapReport } from "../recap/recap";
import { markSessionRecapSeen, SessionRecapBody } from "../recap/SessionRecap";
import { asleepCopy, type LimitState } from "./limits";
import { giveMoreTime } from "./store";
import { familyApi } from "../family/api";
import { useChildView } from "../../app/useChildView";

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
  const [asking, setAsking] = useState<"time" | "recap" | null>(null);
  // Focus lands on the screen itself: nothing is pressed for the child by accident.
  useModal(ref, { open: true, onClose: () => setAsking(null), initialFocus: "body" });
  const copy = asleepCopy(state, child.limits, child.name, now, timeZone);
  const childView = useChildView();

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
        {asking === "time" ? (
          childView ? (
            <AskMoreTimePanel onCancel={() => setAsking(null)} />
          ) : (
            <MoreTimePanel
              child={child}
              bedtime={state.reason === "bedtime"}
              onCancel={() => setAsking(null)}
            />
          )
        ) : asking === "recap" ? (
          <TodayPanel child={child} onDone={() => setAsking(null)} />
        ) : (
          <>
            <div className="fm-asleep__actions">
              <Button variant="primary" onClick={() => setAsking("time")}>
                Ask a grown-up for more time
              </Button>
              {onSomeoneElse ? <Button onClick={onSomeoneElse}>Someone else?</Button> : null}
            </div>
            <Button variant="plain" size="sm" onClick={() => setAsking("recap")}>
              For grown-ups: what {child.name ?? "they"} made today
            </Button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function AskMoreTimePanel({ onCancel }: { readonly onCancel: () => void }) {
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fm-asleep__grownup">
      <p className="fm-asleep__grownup-lead">A grown-up can give you more time.</p>
      {asked ? (
        <p role="status">Asked Mum…</p>
      ) : (
        <div className="fm-asleep__actions">
          <Button onClick={onCancel} disabled={busy}>
            Go back
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void familyApi.createNote({ kind: "more-time" }).then((result) => {
                setBusy(false);
                if (result.ok) setAsked(true);
              });
            }}
          >
            {busy ? "Asking…" : "Ask for more time"}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The session is over: the end-of-session recap, for the grown-up, inside the screen (no sheet
 * on top of it). The parent code opens it; the child sees nothing until then.
 */
function TodayPanel({
  child,
  onDone,
}: {
  readonly child: FamilyChild;
  readonly onDone: () => void;
}) {
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const [report, setReport] = useState<RecapReport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const name = child.name ?? "Your child";
  const entry = useParentCodeEntry(
    (code) => tryParentCode(code, "recap"),
    () =>
      void fetchRecap(child.id, "session").then((result) => {
        if (result.ok) setReport(result.value);
        else setProblem(result.message);
      }),
  );
  const done = () => {
    if (report !== null) markSessionRecapSeen(child.id);
    onDone();
  };
  if (report !== null) {
    return (
      <div className="fm-asleep__recap">
        <SessionRecapBody
          report={report}
          child={child}
          name={name}
          environmentId={environmentIds[0] ?? null}
        />
        <div className="fm-asleep__actions">
          <Button onClick={() => window.print()}>Print or save as PDF</Button>
          <Button variant="primary" onClick={done}>
            Done
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="fm-asleep__grownup" data-sober="">
      <p className="fm-asleep__grownup-lead">For a grown-up: here's what {name} made today.</p>
      <ParentCodeEntry entry={entry} autoFocus />
      {problem ? <p className="fm-help">{problem}</p> : null}
      <div className="fm-asleep__actions">
        <Button onClick={done} disabled={entry.busy}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!entry.canSubmit} onClick={() => void entry.submit()}>
          {entry.busy ? "Checking…" : "Show me"}
        </Button>
      </div>
    </div>
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
