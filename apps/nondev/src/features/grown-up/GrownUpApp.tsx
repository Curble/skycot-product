// A grown-up's own phone or tablet: what SKYCOT shows on a device linked to a grown-up. It can
// read every child's conversations and recap, answer "Ask a grown-up" (Allow once or Decline,
// never "for the session" or "always"), give more time and lock everything. It cannot send
// messages, start conversations, change settings or open files: the engine gives this device
// T3's read scope only and checks every answer itself (family-devices/SkycotFamilyDevices.ts).
// Built phone-first (one column at 390 px), the same Apple-like inset groups as Settings.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  CalendarDays,
  ChevronLeft,
  Clock,
  Lock,
  MessageSquare,
  ScanFace,
  ShieldCheck,
  Smartphone,
  Unlink,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { HOME_HREF, navigate, recapHref, threadHref, useRoute } from "../../router";
import { conversationRowsAtom } from "../../state/conversations";
import { enabledEnvironmentIdsAtom } from "../../state/catalog";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { ListRow } from "../../ui/ListRow";
import { Pill } from "../../ui/Pill";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Sheet } from "../../ui/Sheet";
import { StepBadge } from "../../ui/StepBadge";
import { Mascot } from "../brand/Mascot";
import { ConversationView } from "../conversation/ConversationView";
import { familyApi, type ApproverProof } from "../family/api";
import { ChildAvatar } from "../family/ChildAvatar";
import { childLabel, type FamilyChild } from "../family/children";
import type { FamilyResult } from "../family/family";
import { useFamily } from "../family/FamilyProvider";
import { ParentCodeEntry, useParentCodeEntry } from "../family/ParentCodeEntry";
import {
  grownUpLabel,
  grownUpRequestSentence,
  requestHeading,
  type PendingRequest,
} from "../family/people";
import { refreshFamily, settleWithCode } from "../family/store";
import { todaySummary } from "../family-limits/limits";
import { refreshToday, useLimits } from "../family-limits/store";
import { RecapScreen } from "../recap/RecapScreen";
import { SettingsGroup } from "../settings/SettingsGroup";
import { passkeyProof, passkeysPossible, registerPasskey } from "./passkey";

import "./grown-up.css";

type Tab = "requests" | "children" | "phone";

const REQUESTS_REFRESH_MS = 5_000;

export function GrownUpApp() {
  const route = useRoute();
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const environmentId: EnvironmentId | null = environmentIds[0] ?? null;
  if (route.name === "thread") {
    return (
      <div className="fm-grownup fm-grownup--thread">
        <ReadOnlyConversation environmentId={route.environmentId} threadId={route.threadId} />
      </div>
    );
  }
  if (route.name === "recap") {
    return (
      <div className="fm-grownup fm-grownup--recap">
        <RecapScreen childId={route.childId} environmentId={environmentId} />
      </div>
    );
  }
  return <GrownUpHome />;
}

function GrownUpHome() {
  const { profile } = useFamily();
  const [tab, setTab] = useState<Tab>("requests");
  const me = profile.me.kind === "grown-up" ? profile.me : null;
  const index = profile.grownUps.findIndex((person) => person.id === me?.personId);
  const person = index < 0 ? null : profile.grownUps[index]!;
  const name = person === null ? "Grown-up" : grownUpLabel(person, index);
  const requests = usePendingRequests();
  const waiting = requests.list?.filter((request) => !request.lapsed).length ?? 0;
  return (
    <div className="fm-grownup">
      <header className="fm-grownup__head">
        <Mascot pose={waiting > 0 ? "ask-a-grown-up" : "hello"} size={56} />
        <div>
          <h1 className="fm-grownup__title">Hi {name}</h1>
          <p className="fm-grownup__sub">
            {waiting === 0
              ? "Nothing needs you right now."
              : waiting === 1
                ? "1 request needs a grown-up."
                : `${waiting} requests need a grown-up.`}
          </p>
        </div>
      </header>
      <div className="fm-grownup__tabs">
        <SegmentedControl
          label="Show"
          block
          value={tab}
          onChange={setTab}
          options={[
            { value: "requests", label: waiting > 0 ? `Requests (${waiting})` : "Requests" },
            { value: "children", label: "Children" },
            { value: "phone", label: "This device" },
          ]}
        />
      </div>
      <main className="fm-grownup__body">
        {tab === "requests" ? (
          <RequestsTab requests={requests} />
        ) : tab === "children" ? (
          <ChildrenTab />
        ) : (
          <ThisDeviceTab />
        )}
      </main>
    </div>
  );
}

interface RequestsState {
  readonly list: ReadonlyArray<PendingRequest> | null;
  readonly notes: ReadonlyArray<FamilyNote>;
  /** When the list was read (this device's clock), for "2 minutes ago". */
  readonly readAt: number;
  readonly problem: string | null;
  readonly refresh: () => void;
}

interface FamilyNote {
  readonly id: string;
  readonly kind: "shown" | "more-time";
  readonly childId: string;
  readonly status: "open" | "done";
  readonly title?: string;
  readonly threadId?: string;
}

function usePendingRequests(): RequestsState {
  const [list, setList] = useState<ReadonlyArray<PendingRequest> | null>(null);
  const [readAt, setReadAt] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<ReadonlyArray<FamilyNote>>([]);
  const refresh = useCallback(() => {
    void familyApi.pendingRequests().then((result) => {
      setReadAt(Date.now());
      if (result.ok) {
        setList(result.value);
        setProblem(null);
      } else setProblem(result.message);
    });
    void familyApi.familyNotes().then((result) => {
      if (result.ok)
        setNotes(
          result.value.filter((note): note is FamilyNote => {
            if (typeof note !== "object" || note === null) return false;
            const item = note as Record<string, unknown>;
            return (
              typeof item.id === "string" &&
              typeof item.childId === "string" &&
              (item.kind === "shown" || item.kind === "more-time") &&
              item.status === "open"
            );
          }),
        );
    });
  }, []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, REQUESTS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return { list, notes, readAt, problem, refresh };
}

function RequestsTab({ requests }: { readonly requests: RequestsState }) {
  const { profile } = useFamily();
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  if (requests.problem && requests.list === null) {
    return <Banner tone="warning">{requests.problem}</Banner>;
  }
  if (requests.list === null) return <p className="fm-help">Checking…</p>;
  if (requests.list.length === 0 && requests.notes.length === 0) {
    return (
      <EmptyState icon={ShieldCheck} title="All quiet">
        When a child's work needs a grown-up (the internet, an install, deleting files), it shows
        here. You can say yes once, or no.
      </EmptyState>
    );
  }
  return (
    <div className="fm-grownup__cards">
      {requests.notes.map((note) => {
        const childName = nameOf(profile.children, note.childId);
        return (
          <section className="fm-grownup__request" key={note.id}>
            <h2>
              {note.kind === "shown"
                ? `${childName} made something. Have a look`
                : `${childName} asked for more time`}
            </h2>
            {note.kind === "shown" && note.title ? <p>{note.title}</p> : null}
            {note.kind === "shown" ? (
              <div className="fm-grownup__actions">
                {note.threadId && environmentIds[0] ? (
                  <Button
                    onClick={() =>
                      navigate(threadHref(environmentIds[0]!, note.threadId as ThreadId))
                    }
                  >
                    Open it
                  </Button>
                ) : null}
                <Button
                  onClick={() => void familyApi.seenFamilyNote(note.id).then(requests.refresh)}
                >
                  Seen
                </Button>
              </div>
            ) : (
              <FamilyNoteMoreTime note={note} onDone={requests.refresh} />
            )}
          </section>
        );
      })}
      {requests.list.map((request) => (
        <RequestCard
          key={`${request.threadId}:${request.requestId}`}
          request={request}
          child={profile.children.find((child) => child.id === request.childId) ?? null}
          childName={nameOf(profile.children, request.childId)}
          readAt={requests.readAt}
          onDone={requests.refresh}
        />
      ))}
    </div>
  );
}

function nameOf(children: ReadonlyArray<FamilyChild>, childId: string | null): string {
  const index = children.findIndex((child) => child.id === childId);
  return index < 0 ? "A child" : childLabel(children[index]!, index);
}

function FamilyNoteMoreTime({
  note,
  onDone,
}: {
  readonly note: FamilyNote;
  readonly onDone: () => void;
}) {
  const [minutes, setMinutes] = useState<15 | 30 | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const entry = useParentCodeEntry(
    async (code) => {
      return minutes === null
        ? familyApi.answerFamilyNote({ id: note.id, minutes: 0 })
        : familyApi.answerFamilyNote({ id: note.id, minutes, proof: { type: "code", code } });
    },
    () => {
      setMinutes(null);
      onDone();
    },
  );
  return (
    <>
      <div className="fm-grownup__actions">
        <Button onClick={() => setMinutes(15)}>15 min</Button>
        <Button onClick={() => setMinutes(30)}>30 min</Button>
        <Button
          onClick={() =>
            void familyApi.answerFamilyNote({ id: note.id, minutes: 0 }).then((result) => {
              if (result.ok) onDone();
              else setProblem(result.message);
            })
          }
        >
          Not tonight
        </Button>
      </div>
      {minutes !== null ? (
        <div>
          <p>Enter the parent code to give {minutes} more minutes.</p>
          <ParentCodeEntry entry={entry} />
          <Button disabled={!entry.canSubmit} onClick={() => void entry.submit()}>
            {entry.busy ? "Checking…" : "Give more time"}
          </Button>
          <Button onClick={() => setMinutes(null)}>Cancel</Button>
        </div>
      ) : null}
      {problem ? <Banner tone="warning">{problem}</Banner> : null}
    </>
  );
}

function ageOf(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "Just now";
  return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
}

function RequestCard({
  request,
  child,
  childName,
  readAt,
  onDone,
}: {
  readonly request: PendingRequest;
  readonly child: FamilyChild | null;
  readonly childName: string;
  readonly readAt: number;
  readonly onDone: () => void;
}) {
  const { profile } = useFamily();
  const hasPasskey =
    profile.me.kind === "grown-up" &&
    (profile.devices.find((device) => device.id === (profile.me as { deviceId: string }).deviceId)
      ?.passkeys ?? 0) > 0;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [askCode, setAskCode] = useState(false);
  const [done, setDone] = useState<"accept" | "decline" | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const send = async (decision: "accept" | "decline", proof: ApproverProof | null) => {
    setBusy(true);
    setProblem(null);
    const result = await settleWithCode(
      familyApi.answerRequest({
        threadId: request.threadId,
        requestId: request.requestId,
        decision,
        fingerprint: request.fingerprint,
        proof,
      }),
    );
    setBusy(false);
    if (result.ok) {
      setDone(decision);
      setAskCode(false);
      window.setTimeout(onDone, 1200);
    } else setProblem(result.message);
    return result;
  };

  const allow = async () => {
    if (hasPasskey && passkeysPossible()) {
      setBusy(true);
      const proof = await passkeyProof({
        type: "approve",
        threadId: request.threadId,
        requestId: request.requestId,
        fingerprint: request.fingerprint,
      });
      setBusy(false);
      if (proof.ok) {
        await send("accept", proof.value);
        return;
      }
      setProblem(proof.message);
    }
    setAskCode(true);
  };

  return (
    <article className="fm-grownup__card" aria-label={`${childName}: ${requestHeading(request)}`}>
      <div className="fm-grownup__card-head">
        {child ? <ChildAvatar child={child} size={36} /> : null}
        <div>
          <b>{childName} needs a grown-up</b>
          <small>
            {request.projectTitle ? `${request.projectTitle} · ` : ""}
            {request.threadTitle} · {ageOf(request.createdAt, readAt)}
          </small>
        </div>
      </div>
      <p className="fm-grownup__card-what">{grownUpRequestSentence(request, childName)}</p>
      <Button size="sm" variant="plain" onClick={() => setShowDetails((value) => !value)}>
        {showDetails ? "Hide details" : "Show details"}
      </Button>
      {showDetails ? (
        <>
          <p className="fm-grownup__card-what">
            <span>{requestHeading(request)}</span>
            {request.what ? <code>{request.what}</code> : null}
          </p>
          {request.why ? <p className="fm-grownup__card-why">{request.why}</p> : null}
        </>
      ) : null}
      {done !== null ? (
        <Banner tone="info">
          {done === "accept" ? "Allowed, this once." : "Declined. They see that on their screen."}
        </Banner>
      ) : request.lapsed ? (
        <Banner tone="info">This one is waiting on the Mac now. Answer it there.</Banner>
      ) : (
        <div className="fm-grownup__card-actions">
          <Button disabled={busy} onClick={() => void send("decline", null)}>
            Decline
          </Button>
          <Button
            variant="primary"
            {...(hasPasskey && passkeysPossible() ? { icon: ScanFace } : {})}
            disabled={busy}
            onClick={() => void allow()}
          >
            Allow once
          </Button>
        </div>
      )}
      {problem ? <Banner tone="warning">{problem}</Banner> : null}
      {askCode ? (
        <CodeSheet
          title="Allow this once?"
          description={`${childName}'s ${requestHeading(request).toLowerCase()}. Enter the parent code to allow it, this once.`}
          onClose={() => setAskCode(false)}
          attempt={(code) => send("accept", { type: "code", code })}
          confirm="Allow once"
        />
      ) : null}
    </article>
  );
}

function CodeSheet({
  title,
  description,
  onClose,
  attempt,
  confirm,
}: {
  readonly title: string;
  readonly description: string;
  readonly onClose: () => void;
  readonly attempt: (code: string) => Promise<FamilyResult<unknown>>;
  readonly confirm: string;
}) {
  const entry = useParentCodeEntry(attempt, onClose);
  return (
    <Sheet
      open
      onClose={onClose}
      icon={Lock}
      title={title}
      description={description}
      sober
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!entry.canSubmit} onClick={() => void entry.submit()}>
            {entry.busy ? "Checking…" : confirm}
          </Button>
        </>
      }
    >
      <ParentCodeEntry entry={entry} autoFocus />
    </Sheet>
  );
}

const TODAY_REFRESH_MS = 60_000;

function ChildrenTab() {
  const { profile } = useFamily();
  const { today } = useLimits();
  const [moreFor, setMoreFor] = useState<FamilyChild | null>(null);
  const [conversationsOf, setConversationsOf] = useState<FamilyChild | null>(null);
  useEffect(() => {
    void refreshToday();
    const timer = window.setInterval(() => void refreshToday(), TODAY_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);
  if (conversationsOf !== null) {
    return <ChildConversations child={conversationsOf} onBack={() => setConversationsOf(null)} />;
  }
  return (
    <>
      {profile.children.map((child, index) => {
        const state = today.children.find((entry) => entry.childId === child.id)?.limits ?? null;
        const label = childLabel(child, index);
        return (
          <SettingsGroup key={child.id} title={label}>
            <ListRow
              leading={<ChildAvatar child={child} size={36} />}
              title={
                <span className="fm-grownup__child">
                  {label}
                  {state?.asleep ? (
                    <Pill tone="neutral" size="sm">
                      Asleep
                    </Pill>
                  ) : null}
                </span>
              }
              subtitle={state === null ? "Nothing yet today." : todaySummary(state, child.limits)}
            />
            <ListRow
              leading={<StepBadge state="todo" icon={MessageSquare} />}
              title="Conversations"
              subtitle="Read what they asked and what Sam did."
              chevron
              onClick={() => setConversationsOf(child)}
            />
            <ListRow
              leading={<StepBadge state="todo" icon={CalendarDays} />}
              title={`${label}'s week`}
              subtitle="What they made, asked for and needed help with."
              chevron
              onClick={() => navigate(recapHref(child.id))}
            />
            <ListRow
              leading={<StepBadge state="todo" icon={Clock} />}
              title="More time"
              subtitle="15 or 30 minutes, or no bedtime tonight."
              trailing={
                <Button size="sm" onClick={() => setMoreFor(child)}>
                  Give…
                </Button>
              }
            />
          </SettingsGroup>
        );
      })}
      {moreFor !== null ? <MoreTimeSheet child={moreFor} onClose={() => setMoreFor(null)} /> : null}
    </>
  );
}

function ChildConversations({
  child,
  onBack,
}: {
  readonly child: FamilyChild;
  readonly onBack: () => void;
}) {
  const rows = useAtomValue(conversationRowsAtom);
  const { today } = useLimits();
  const mine = rows.filter((row) => today.threads[row.shell.id] === child.id);
  return (
    <>
      <Button variant="plain" size="sm" icon={ChevronLeft} onClick={onBack}>
        Children
      </Button>
      <SettingsGroup title={`${child.name ?? "Their"} conversations`}>
        {mine.length === 0 ? (
          <ListRow title="No conversations yet" />
        ) : (
          mine.map((row) => (
            <ListRow
              key={row.shell.id}
              title={row.title}
              subtitle={row.preview || row.project?.title || ""}
              chevron
              onClick={() => navigate(threadHref(row.shell.environmentId, row.shell.id))}
            />
          ))
        )}
      </SettingsGroup>
    </>
  );
}

function MoreTimeSheet({
  child,
  onClose,
}: {
  readonly child: FamilyChild;
  readonly onClose: () => void;
}) {
  const { profile } = useFamily();
  const [kind, setKind] = useState<"extra15" | "extra30" | "endBedtime">("extra15");
  const [askCode, setAskCode] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const me = profile.me.kind === "grown-up" ? profile.me : null;
  const hasPasskey =
    (profile.devices.find((device) => device.id === me?.deviceId)?.passkeys ?? 0) > 0;
  const send = async (proof: ApproverProof) => {
    const result = await settleWithCode(
      familyApi.approverMoreTime({ childId: child.id, kind, proof }),
    );
    if (result.ok) {
      setDone(true);
      void refreshToday();
    } else setProblem(result.message);
    return result;
  };
  const give = async () => {
    setProblem(null);
    if (hasPasskey && passkeysPossible()) {
      const proof = await passkeyProof({ type: "more-time", childId: child.id, kind });
      if (proof.ok) {
        await send(proof.value);
        return;
      }
      setProblem(proof.message);
    }
    setAskCode(true);
  };
  const name = child.name ?? "them";
  return (
    <Sheet
      open
      onClose={onClose}
      icon={Clock}
      title={done ? "More time given" : `More time for ${name}`}
      description={done ? `${name} can keep going.` : "SKYCOT wakes for them straight away."}
      sober
      actions={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              {...(hasPasskey && passkeysPossible() ? { icon: ScanFace } : {})}
              onClick={() => void give()}
            >
              Give time
            </Button>
          </>
        )
      }
    >
      {done ? null : (
        <SegmentedControl
          label="How much"
          block
          wrap
          value={kind}
          onChange={setKind}
          options={[
            { value: "extra15", label: "15 minutes" },
            { value: "extra30", label: "30 minutes" },
            { value: "endBedtime", label: "No bedtime tonight" },
          ]}
        />
      )}
      {problem ? <Banner tone="warning">{problem}</Banner> : null}
      {askCode ? (
        <CodeSheet
          title="Give more time?"
          description="Enter the parent code."
          onClose={() => setAskCode(false)}
          attempt={(code) => send({ type: "code", code })}
          confirm="Give time"
        />
      ) : null}
    </Sheet>
  );
}

function ThisDeviceTab() {
  const { profile } = useFamily();
  const me = profile.me.kind === "grown-up" ? profile.me : null;
  const passkeys = profile.devices.find((device) => device.id === me?.deviceId)?.passkeys ?? 0;
  const [setup, setSetup] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const possible = passkeysPossible();
  return (
    <>
      <SettingsGroup
        title="Face ID"
        footer={
          possible
            ? "Face ID (or Touch ID, or this device's passcode) says yes instead of typing the parent code. It stays on this device; SKYCOT keeps only a public key."
            : "Face ID needs a secure connection to the Mac, which this address isn't. Use the parent code for now; SKYCOT Relay will bring Face ID to phones away from the Mac."
        }
      >
        <ListRow
          leading={<StepBadge state={passkeys > 0 ? "ok" : "todo"} icon={ScanFace} />}
          title={passkeys > 0 ? "Face ID is on for this device" : "Use Face ID to say yes"}
          subtitle={
            passkeys > 0 ? "Yes needs Face ID each time." : "Set it up once with the parent code."
          }
          trailing={
            passkeys > 0 ? (
              <Button
                size="sm"
                onClick={() =>
                  void familyApi.passkeyForget().then(() => {
                    void refreshFamily();
                  })
                }
              >
                Turn off
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                disabled={!possible}
                onClick={() => setSetup(true)}
              >
                Set up…
              </Button>
            )
          }
        />
      </SettingsGroup>
      <SettingsGroup
        title="Lock"
        footer="Ends every grown-up's yes on every device, such as Advanced mode left open on the Mac. Nothing else changes."
      >
        <ListRow
          leading={<StepBadge state={locked ? "ok" : "todo"} icon={Lock} />}
          title={locked ? "Everything is locked" : "Lock everything"}
          trailing={
            <Button
              size="sm"
              onClick={() => void familyApi.lockEverything().then((result) => setLocked(result.ok))}
            >
              Lock
            </Button>
          }
        />
      </SettingsGroup>
      <SettingsGroup title="This device">
        <ListRow
          leading={<StepBadge state="ok" icon={Smartphone} />}
          title={me?.deviceName ?? "This device"}
          subtitle="A grown-up's device: it reads and says yes or no, and can't change anything."
        />
        <ListRow
          leading={<StepBadge state="warn" icon={Unlink} />}
          title="Unlink this device"
          subtitle="It stops working with SKYCOT straight away."
          trailing={
            <Button size="sm" variant="destructive" onClick={() => setConfirmUnlink(true)}>
              Unlink…
            </Button>
          }
        />
      </SettingsGroup>
      {message ? <Banner tone="info">{message}</Banner> : null}
      {setup ? (
        <CodeSheet
          title="Use Face ID to say yes"
          description="Enter the parent code once. Then your device asks for Face ID."
          onClose={() => setSetup(false)}
          attempt={async (code) => {
            const result = await settleWithCode(registerPasskey(code));
            if (result.ok) {
              setMessage("Face ID is ready. Yes now needs Face ID each time.");
              void refreshFamily();
            }
            return result;
          }}
          confirm="Continue"
        />
      ) : null}
      <Sheet
        open={confirmUnlink}
        onClose={() => setConfirmUnlink(false)}
        icon={Unlink}
        iconTone="red"
        title="Unlink this device?"
        description="It stops working with SKYCOT straight away and forgets its Face ID. A grown-up can link it again from the family's Mac."
        sober
        actions={
          <>
            <Button onClick={() => setConfirmUnlink(false)}>Keep it</Button>
            <Button
              variant="destructive"
              filled
              onClick={() =>
                void familyApi.unlinkSelf().then(() => {
                  window.location.reload();
                })
              }
            >
              Unlink
            </Button>
          </>
        }
      />
    </>
  );
}

/** A child's conversation on a grown-up's phone: to read, with no way to reply. */
function ReadOnlyConversation({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  return (
    <>
      <div className="fm-grownup__readonly">
        <Button variant="plain" size="sm" icon={ChevronLeft} onClick={() => navigate(HOME_HREF)}>
          Back
        </Button>
        <span>Read only on this device</span>
      </div>
      <ConversationView environmentId={environmentId} threadId={threadId} showBack={false} />
    </>
  );
}
