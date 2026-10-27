import { useAtomValue } from "@effect/atom-react";
import { ChevronLeft, ListTodo, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { useShellState } from "../../app/ShellState";
import { useConnected } from "../../app/useConnection";
import { HOME_HREF, navigate, threadHref } from "../../router";
import { conversationRowsAtom, type ConversationRow } from "../../state/conversations";
import { useCrew } from "../../themes/useCrew";
import { useFamily } from "../family/FamilyProvider";
import { useChildView } from "../../app/useChildView";
import { askWhoStarted, useLimits } from "../family-limits/store";
import { grownUpSessionFor, useGrownUpSessionId } from "../family/grownUpSession";
import { IconButton } from "../../ui/Button";
import { Card, CardBody, CardHeader } from "../../ui/Card";
import { List, ListRow } from "../../ui/ListRow";
import { StepBadge } from "../../ui/StepBadge";
import { Mascot } from "../brand/Mascot";
import { mascotCopy } from "../brand/mascotCopy";
import { NewConversationComposer } from "../compose/NewConversationComposer";
import { usePlanFirst } from "../compose/planFirst";
import { FridgeHomeTile } from "../fridge/FridgeHomeTile";
import { seedFor, StarterCards, useStarters, type ComposerSeed } from "../starters/StarterCards";
import { homeTip } from "./tip";
import { homeRows, summarySentence, threadIdsWithoutOwner } from "./summary";
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
  const childView = useChildView();
  const { today } = useLimits();
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

  const active = homeRows(
    rows,
    childView,
    family.profile.me.kind === "child" ? family.profile.me.childId : family.profile.currentChildId,
    today.threads,
  );
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
          <div className="fm-home__hello">
            <Mascot pose="hello" size={72} decorative />
            <div>
              <p className="fm-home__from">{mascotCopy.homeHello}</p>
              {/* No name unless the Family profile gave one: the only other label is the Mac's, and "Good evening, iMac" is worse than none. */}
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
            </div>
          </div>
          <StarterCards
            onPick={(starter) => {
              setSeed(seedFor(starter));
              // The file picker only opens inside the tap itself (browsers require a user
              // gesture), so "Draw it, then build it" clicks the composer's picture input here.
              if (starter.kind === "picture") {
                document.querySelector<HTMLInputElement>(".fm-composer__file")?.click();
              }
            }}
          />
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
                    active.length === 0
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
                    <List
                      label={
                        family.enabled && family.profile.me.kind !== "grown-up"
                          ? "Things Sam is making"
                          : "Jobs"
                      }
                    >
                      {active.map((row) => (
                        <JobRow key={`${row.shell.environmentId}:${row.shell.id}`} row={row} />
                      ))}
                    </List>
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
        </div>
      </div>
      <NewConversationComposer preferredProjectKey={shell.projectKey} seed={seed} />
    </>
  );
}

function JobRow({ row }: { readonly row: ConversationRow }) {
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
    <ListRow
      leading={lead}
      title={row.title}
      subtitle={`${row.project?.title ?? "Project"} · ${headline}`}
      chevron
      href={threadHref(row.shell.environmentId, row.shell.id)}
    />
  );
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
}
