import { useAtomValue } from "@effect/atom-react";
import { ChevronLeft, ListTodo, Pin, Sparkles, Users } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";

import { useShellState } from "../../app/ShellState";
import { useConnected } from "../../app/useConnection";
import { HOME_HREF, navigate, threadHref, WELCOME_HREF } from "../../router";
import {
  conversationListArrivedAtom,
  conversationRowsAtom,
  type ConversationRow,
} from "../../state/conversations";
import { useCrew } from "../../themes/useCrew";
import { familyCopy } from "../family/copy";
import { familyIdentityPending } from "../family/family";
import { useFamily } from "../family/FamilyProvider";
import { useChildView } from "../../app/useChildView";
import { askTodayOnce, askWhoStarted, useLimits } from "../family-limits/store";
import { grownUpSessionFor, useGrownUpSessionId } from "../family/grownUpSession";
import { Button, IconButton } from "../../ui/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../ui/Card";
import { ContextMenu, type MenuPoint } from "../../ui/ContextMenu";
import { List, ListRow } from "../../ui/ListRow";
import { ConversationMenuItems } from "../tidy/ConversationMenu";
import { DeleteSheet } from "../tidy/DeleteSheet";
import { isPinned, splitPinned } from "../tidy/pinned";
import { RenameSheet } from "../tidy/RenameSheet";
import { StepBadge } from "../../ui/StepBadge";
import { Mascot } from "../brand/Mascot";
import { mascotCopy } from "../brand/mascotCopy";
import { NewConversationComposer } from "../compose/NewConversationComposer";
import { usePlanFirst } from "../compose/planFirst";
import { FridgeHomeTile } from "../fridge/FridgeHomeTile";
import { StarterCards, useStarters, type ComposerSeed } from "../starters/StarterCards";
import { useStarterPick } from "../starters/BuildHelpSheet";
import { showsFamilySetupCard } from "../onboarding/onboarding";
import { homeTip } from "./tip";
import { homeListPending, homeRows, summarySentence, threadIdsWithoutOwner } from "./summary";
import { greeting as greetingForHour } from "./greeting";

/**
 * Home: a greeting, the starter cards, every live or attention-needing job in one sentence
 * each, a tip, and the compose box. The allowance meter is intentionally absent: the
 * engine's usage summary is a log scan, not a cheap read, and we never show
 * made-up numbers. Mount `AllowanceMeter` in `.fm-home__side` when a cheap
 * source exists.
 */
export function HomeView({ showBack = false }: { readonly showBack?: boolean }) {
  const shell = useShellState();
  const crew = useCrew();
  const planFirst = usePlanFirst();
  const rows = useAtomValue(conversationRowsAtom);
  const connected = useConnected();
  const family = useFamily();
  // Before the engine says who is here there is no honest greeting and no honest "waiting".
  const identityPending = familyIdentityPending(family.profile);
  const childView = useChildView();
  const { today, todayAnswered } = useLimits();
  const listArrived = useAtomValue(conversationListArrivedAtom);
  const listPending = homeListPending({
    connected,
    listArrived,
    childView,
    ownersLoaded: todayAnswered,
  });
  useEffect(() => {
    if (childView && connected) askTodayOnce();
  }, [childView, connected]);
  useEffect(() => {
    const unknown = threadIdsWithoutOwner(rows, today.threads);
    if (unknown.length > 0) askWhoStarted(unknown);
  }, [rows, today.threads]);
  // A grown-up who picked themselves on the shared Mac is greeted by name.
  const grownUpId = grownUpSessionFor(useGrownUpSessionId(), family.profile, Date.now());
  const grownUpName =
    grownUpId === null
      ? null
      : (family.profile.grownUps.find((person) => person.id === grownUpId)?.name ?? null);
  const { kids } = useStarters();
  const [seed, setSeed] = useState<ComposerSeed | null>(null);
  const starterPick = useStarterPick(setSeed);
  const [renaming, setRenaming] = useState<ConversationRow | null>(null);
  const [deleting, setDeleting] = useState<ConversationRow | null>(null);

  const active = homeRows(
    rows,
    childView,
    family.profile.me.kind === "child" ? family.profile.me.childId : family.profile.currentChildId,
    today.threads,
  );
  const { pinned: pinnedJobs, rest: otherJobs } = splitPinned(active);
  const working = active.filter(
    (row) => row.status.kind === "working" || row.status.kind === "preparing",
  ).length;
  const needsGrownUp = active.filter(
    (row) => row.status.kind === "waiting" && row.status.headline.includes("grown-up"),
  ).length;
  const waiting = active.filter(
    (row) =>
      (row.status.kind === "waiting" || (!childView && row.status.kind === "plan")) &&
      !row.status.headline.includes("grown-up") &&
      !(childView && row.shell.hasActionableProposedPlan),
  ).length;
  const plansReady = childView ? active.filter((row) => row.status.kind === "plan").length : 0;
  const ready = active.filter((row) => row.status.kind === "ready").length;
  const failed = active.filter((row) => row.status.kind === "failed").length;

  return (
    <>
      <div className="fm-home">
        <div className="fm-home__inner">
          {showBack ? (
            <div className="fm-home__nav">
              <IconButton
                icon={ChevronLeft}
                label="Back to conversations"
                onClick={() => navigate(HOME_HREF)}
              />
            </div>
          ) : null}
          {showsFamilySetupCard(family.profile) ? <FamilySetupCard /> : null}
          <div className="fm-home__hello">
            <Mascot pose="hello" size={72} decorative />
            <div>
              <p className="fm-home__from">{mascotCopy.homeHello}</p>
              {/* No name unless the Family profile gave one: the only other label is the Mac's, and "Good evening, iMac" is worse than none. */}
              {identityPending ? null : (
                <h2 className="fm-home__greeting">
                  <span className="fm-marker-underline">
                    {greetingForHour(new Date().getHours())}
                    {family.enabled && grownUpName
                      ? `, ${grownUpName}`
                      : family.enabled && grownUpId === null && family.profile.childName
                        ? `, ${family.profile.childName}`
                        : ""}
                    .
                  </span>
                </h2>
              )}
              {identityPending ? null : listPending ? (
                // Same line height as the sentence, so nothing jumps when the real one lands.
                <p className="fm-home__sub" aria-busy="true">
                  {"\u00a0"}
                </p>
              ) : (
                <p className="fm-home__sub">
                  {summarySentence(
                    working,
                    waiting,
                    ready,
                    active.length,
                    connected,
                    childView,
                    needsGrownUp,
                    failed,
                    plansReady,
                  )}
                </p>
              )}
            </div>
          </div>
          <StarterCards onPick={starterPick.pick} />
          {starterPick.sheet}
          <div className="fm-home__grid">
            <div className="fm-home__main">
              <Card
                label={
                  family.enabled && family.profile.me.kind !== "grown-up"
                    ? "Your things"
                    : "Today, across every project"
                }
              >
                <CardHeader
                  icon={ListTodo}
                  title={
                    family.enabled && family.profile.me.kind !== "grown-up"
                      ? "Your things"
                      : "Today, across every project"
                  }
                  subtitle={
                    active.length === 0 && listPending
                      ? "Looking…"
                      : active.length === 0
                        ? connected
                          ? family.enabled && family.profile.me.kind !== "grown-up"
                            ? "Sam isn't making anything right now."
                            : "Nothing is running or waiting on you right now."
                          : "Your jobs appear once your Mac is reachable."
                        : family.enabled && family.profile.me.kind !== "grown-up"
                          ? "Tap any thing to see it."
                          : "Tap any row to open its conversation."
                  }
                />
                {active.length > 0 ? (
                  <CardBody>
                    {/* Only rows already limited to this child's own (see homeRows). */}
                    {pinnedJobs.length > 0 ? (
                      <>
                        <p className="fm-home__group">Pinned</p>
                        <List label="Pinned">
                          {pinnedJobs.map((row) => (
                            <JobRow
                              key={`${row.shell.environmentId}:${row.shell.id}`}
                              row={row}
                              onRename={() => setRenaming(row)}
                              onDelete={() => setDeleting(row)}
                            />
                          ))}
                        </List>
                      </>
                    ) : null}
                    {otherJobs.length > 0 ? (
                      <>
                        {pinnedJobs.length > 0 ? <p className="fm-home__group">Others</p> : null}
                        <List
                          label={
                            family.enabled && family.profile.me.kind !== "grown-up"
                              ? "Things Sam is making"
                              : "Jobs"
                          }
                        >
                          {otherJobs.map((row) => (
                            <JobRow
                              key={`${row.shell.environmentId}:${row.shell.id}`}
                              row={row}
                              onRename={() => setRenaming(row)}
                              onDelete={() => setDeleting(row)}
                            />
                          ))}
                        </List>
                      </>
                    ) : null}
                  </CardBody>
                ) : null}
              </Card>
              {/* Under "Today", not below the fridge: on a laptop it stays above the fold. */}
              <Card label="Tip" tip>
                <CardHeader
                  icon={Sparkles}
                  tone="grey"
                  title="Tip"
                  subtitle={homeTip(kids, crew.builder.name, planFirst.on)}
                />
              </Card>
            </div>
            <div className="fm-home__side">
              <FridgeHomeTile />
            </div>
          </div>
          {childView ? <p className="fm-home__privacy fm-help">{familyCopy.privacyLine}</p> : null}
        </div>
      </div>
      <NewConversationComposer preferredProjectKey={shell.projectKey} seed={seed} />
      <RenameSheet
        shell={renaming?.shell ?? null}
        currentTitle={renaming?.title ?? ""}
        archived={false}
        onClose={() => setRenaming(null)}
      />
      <DeleteSheet
        shell={deleting?.shell ?? null}
        currentTitle={deleting?.title ?? ""}
        archived={false}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

/** After "Skip for now": one calm offer to set SKYCOT up for a family, until a profile exists. */
function FamilySetupCard() {
  const crew = useCrew();
  const family = useFamily();
  return (
    <Card label="Set SKYCOT up for your family">
      <CardHeader
        icon={Users}
        tone="blue"
        title="Set SKYCOT up for your family"
        subtitle={`A parent code, a name for each child, and ${crew.builder.name} explains things their way.`}
      />
      <CardFooter>
        <Button variant="primary" onClick={() => navigate(WELCOME_HREF)}>
          Set up
        </Button>
        <Button variant="quiet" onClick={() => void family.setWelcome("done")}>
          I'm using SKYCOT myself
        </Button>
      </CardFooter>
    </Card>
  );
}

function JobRow({
  row,
  onRename,
  onDelete,
}: {
  readonly row: ConversationRow;
  readonly onRename: () => void;
  readonly onDelete: () => void;
}) {
  const [menuAt, setMenuAt] = useState<MenuPoint | null>(null);
  const crew = useCrew();
  const family = useFamily();
  const childView = family.enabled && family.profile.me.kind !== "grown-up";
  const headline = childView
    ? row.status.headline.replaceAll("Sam", crew.builder.name)
    : lowerFirst(row.status.headline);
  const lead =
    row.status.kind === "waiting" && row.status.headline.includes("grown-up") ? (
      <StepBadge state="warn" label="Needs a grown-up" />
    ) : row.status.kind === "plan" && childView ? (
      <StepBadge state="now" label="Plan ready" />
    ) : row.status.kind === "waiting" || row.status.kind === "plan" ? (
      <StepBadge state="warn" label="Waiting for you" />
    ) : row.status.kind === "ready" ? (
      <StepBadge state="done" label="Done" />
    ) : row.status.kind === "failed" ? (
      <StepBadge state="fail" label="Something went wrong" />
    ) : (
      <StepBadge state="now" label="Working" />
    );
  return (
    <>
      <ListRow
        leading={lead}
        title={
          isPinned(row.shell) ? (
            <>
              <Pin
                className="fm-convrow__pin"
                size={11}
                strokeWidth={2}
                role="img"
                aria-label="Pinned"
              />
              {row.title}
            </>
          ) : (
            row.title
          )
        }
        subtitle={`${row.project?.title ?? "Project"} · ${headline}`}
        chevron
        href={threadHref(row.shell.environmentId, row.shell.id)}
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault();
          setMenuAt({ x: event.clientX, y: event.clientY });
        }}
      />
      <ContextMenu at={menuAt} onClose={() => setMenuAt(null)} label={row.title}>
        {(close) => (
          <ConversationMenuItems
            shell={row.shell}
            archived={false}
            onRename={onRename}
            onDelete={onDelete}
            close={close}
          />
        )}
      </ContextMenu>
    </>
  );
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
}
