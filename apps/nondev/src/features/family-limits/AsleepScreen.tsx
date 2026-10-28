// "SKYCOT is asleep": the calm full-screen moment a child sees at bedtime, when today's time
// or messages run out, or when the AI allowance is down to the grown-ups' share. The engine has
// already stopped new turns; this screen only says so kindly and offers the grown-up's way
// round: the parent code, then 15 or 30 more minutes, or bedtime over for tonight. Everything
// happens inside the screen (no sheet on top), and the code prompt is sober in every theme.
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { enabledEnvironmentIdsAtom } from "../../state/catalog";

import { Button } from "../../ui/Button";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { useModal } from "../../ui/useModal";
import { Mascot } from "../brand/Mascot";
import type { FamilyChild } from "../family/children";
import { ParentCodeEntry, useParentCodeEntry } from "../family/ParentCodeEntry";
import { tryParentCode, useFamilyView } from "../family/store";
import { fetchRecap } from "../recap/api";
import type { RecapReport } from "../recap/recap";
import { markSessionRecapSeen, SessionRecapBody } from "../recap/SessionRecap";
import { asleepCopy, type LimitState } from "./limits";
import { giveMoreTime } from "./store";
import { familyApi } from "../family/api";
import {
  askedWho,
  moreTimeAnswerFor,
  moreTimeAnswerLine,
  type MoreTimeAnswer,
} from "./moreTimeAnswer";
import { useChildView } from "../../app/useChildView";
import { grownUpPhonesLinked, moreTimeWays } from "./moreTimeWays";

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
  const view = useFamilyView();
  const ways = moreTimeWays({
    me: view.me,
    grownUpPhonesLinked: grownUpPhonesLinked(view.grownUps, view.devices),
    childView,
  });
  // With both ways on offer the child first picks one; with one way it opens straight away.
  const [way, setWay] = useState<"code" | "phone" | null>(null);
  const chosen = ways.length === 1 ? ways[0]! : way;
  const closeTime = () => {
    setAsking(null);
    setWay(null);
  };

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
          chosen === "phone" ? (
            <AskMoreTimePanel onCancel={closeTime} />
          ) : chosen === "code" ? (
            <MoreTimePanel
              child={child}
              bedtime={state.reason === "bedtime"}
              onCancel={closeTime}
            />
          ) : (
            <div className="fm-asleep__grownup">
              <p className="fm-asleep__grownup-lead">Who can give you more time?</p>
              <div className="fm-asleep__actions">
                <Button variant="primary" autoFocus onClick={() => setWay("code")}>
                  A grown-up is here
                </Button>
                <Button onClick={() => setWay("phone")}>Ask on their phone</Button>
                <Button variant="plain" onClick={closeTime}>
                  Go back
                </Button>
              </div>
            </div>
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
  const view = useFamilyView();
  const [noteId, setNoteId] = useState<string | null>(null);
  const [answer, setAnswer] = useState<MoreTimeAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const who = askedWho(view.grownUps.map((person) => person.name));
  // Waiting for the grown-up's answer: look again every few seconds (a yes also lifts this
  // screen at the next heartbeat; a "Not tonight" only shows here).
  useEffect(() => {
    if (noteId === null || answer !== null) return;
    const timer = window.setInterval(() => {
      void familyApi.childNotes().then((result) => {
        if (!result.ok) return;
        const found = moreTimeAnswerFor(result.value, noteId);
        if (found !== null) setAnswer(found);
      });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [noteId, answer]);
  return (
    <div className="fm-asleep__grownup">
      <p className="fm-asleep__grownup-lead">A grown-up can give you more time.</p>
      {answer !== null ? (
        <p role="status">{moreTimeAnswerLine(answer)}</p>
      ) : noteId !== null ? (
        <p role="status">Asked {who}…</p>
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
                const id = (result.ok ? (result.value as { id?: unknown }) : null)?.id;
                if (typeof id === "string") setNoteId(id);
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
