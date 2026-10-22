import { useAtomValue } from "@effect/atom-react";
import { ChevronLeft, ListTodo, Sparkles } from "lucide-react";
import { useState } from "react";

import { useShellState } from "../../app/ShellState";
import { useConnected } from "../../app/useConnection";
import { HOME_HREF, navigate, threadHref } from "../../router";
import { conversationRowsAtom, type ConversationRow } from "../../state/conversations";
import { useCrew } from "../../themes/useCrew";
import { useFamily } from "../family/FamilyProvider";
import { IconButton } from "../../ui/Button";
import { Card, CardBody, CardHeader } from "../../ui/Card";
import { List, ListRow } from "../../ui/ListRow";
import { StepBadge } from "../../ui/StepBadge";
import { Mascot } from "../brand/Mascot";
import { mascotCopy } from "../brand/mascotCopy";
import { NewConversationComposer } from "../compose/NewConversationComposer";
import { FridgeHomeTile } from "../fridge/FridgeHomeTile";
import { seedFor, StarterCards, type ComposerSeed } from "../starters/StarterCards";
import { summarySentence } from "./summary";

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
  const rows = useAtomValue(conversationRowsAtom);
  const connected = useConnected();
  const family = useFamily();
  const [seed, setSeed] = useState<ComposerSeed | null>(null);

  const active = rows.filter(
    (row) =>
      row.status.kind === "working" ||
      row.status.kind === "preparing" ||
      row.status.kind === "waiting" ||
      row.status.kind === "ready" ||
      row.status.kind === "failed",
  );
  const working = active.filter(
    (row) => row.status.kind === "working" || row.status.kind === "preparing",
  ).length;
  const waiting = active.filter((row) => row.status.kind === "waiting").length;
  const ready = active.filter((row) => row.status.kind === "ready").length;

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
                  {greeting()}
                  {family.enabled && family.profile.childName
                    ? `, ${family.profile.childName}`
                    : ""}
                  .
                </span>
              </h2>
              <p className="fm-home__sub">
                {summarySentence(working, waiting, ready, rows.length, connected)}
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
            <Card label="Today, across every project">
              <CardHeader
                icon={ListTodo}
                title="Today, across every project"
                subtitle={
                  active.length === 0
                    ? connected
                      ? "Nothing is running or waiting on you right now."
                      : "Your jobs appear once your Mac is reachable."
                    : "Tap any row to open its conversation."
                }
              />
              {active.length > 0 ? (
                <CardBody>
                  <List label="Jobs">
                    {active.map((row) => (
                      <JobRow key={`${row.shell.environmentId}:${row.shell.id}`} row={row} />
                    ))}
                  </List>
                </CardBody>
              ) : null}
            </Card>
            <div className="fm-home__side">
              <FridgeHomeTile />
              <Card label="Tip" tip>
                <CardHeader
                  icon={Sparkles}
                  tone="grey"
                  title="Tip"
                  subtitle={`Say it like you'd text a staff member. “Add a Christmas menu page” beats describing how to build one. ${crew.builder.name} will show you a plan before touching anything.`}
                />
              </Card>
            </div>
          </div>
        </div>
      </div>
      <NewConversationComposer preferredProjectKey={shell.projectKey} seed={seed} />
    </>
  );
}

function JobRow({ row }: { readonly row: ConversationRow }) {
  const lead =
    row.status.kind === "waiting" ? (
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
      subtitle={`${row.project?.title ?? "Project"} · ${lowerFirst(row.status.headline)}`}
      chevron
      href={threadHref(row.shell.environmentId, row.shell.id)}
    />
  );
}

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
}
