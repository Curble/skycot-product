import { useAtomValue } from "@effect/atom-react";
import { ListTodo, Sparkles } from "lucide-react";

import { useShellState } from "../../app/ShellState";
import { threadHref } from "../../router";
import { enabledEnvironmentIdsAtom, environmentCatalog } from "../../state/catalog";
import { conversationRowsAtom, type ConversationRow } from "../../state/conversations";
import { useCrew } from "../../themes/useCrew";
import { Card, CardBody, CardHeader } from "../../ui/Card";
import { List, ListRow } from "../../ui/ListRow";
import { StepBadge } from "../../ui/StepBadge";
import { NewConversationComposer } from "../compose/NewConversationComposer";

/**
 * Home: a greeting, every live or attention-needing job in one sentence each,
 * a tip, and the compose box. The allowance meter is intentionally absent: the
 * engine's usage summary is a log scan, not a cheap read, and we never show
 * made-up numbers. Mount `AllowanceMeter` in `.fm-home__side` when a cheap
 * source exists.
 */
export function HomeView() {
  const shell = useShellState();
  const crew = useCrew();
  const rows = useAtomValue(conversationRowsAtom);
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const label = environmentIds[0]
    ? catalog.entries.get(environmentIds[0])?.target.label
    : undefined;

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
          <div>
            <h2 className="fm-home__greeting">
              <span className="fm-marker-underline">
                {greeting()}
                {firstName(label) ? `, ${firstName(label)}` : ""}.
              </span>
            </h2>
            <p className="fm-home__sub">{summarySentence(working, waiting, ready, rows.length)}</p>
          </div>
          <div className="fm-home__grid">
            <Card label="Today, across every project">
              <CardHeader
                icon={ListTodo}
                title="Today, across every project"
                subtitle={
                  active.length === 0
                    ? "Nothing is running or waiting on you right now."
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
      <NewConversationComposer preferredProjectKey={shell.projectKey} />
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

// No user identity reaches the client yet; the environment label (the Mac's
// name) is the closest thing. A label like "Mark's MacBook" yields "Mark".
function firstName(label: string | undefined): string | null {
  if (!label) return null;
  const match = /^([A-Za-z][A-Za-z'’-]*)/.exec(label.trim());
  if (!match) return null;
  const word = match[1]!.replace(/['’]s$/i, "");
  return word.length > 1 ? word : null;
}

function summarySentence(working: number, waiting: number, ready: number, total: number): string {
  if (total === 0) return "Nothing is on the go yet. Start a conversation below.";
  const parts: string[] = [];
  if (working > 0) parts.push(`${count(working, "job is", "jobs are")} running`);
  if (waiting > 0) parts.push(`${count(waiting, "is", "are")} waiting on you`);
  if (ready > 0) parts.push(`${count(ready, "is", "are")} ready to look at`);
  if (parts.length === 0) return "All quiet. Nothing is running or waiting on you.";
  const sentence = parts.join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function count(n: number, one: string, many: string): string {
  const word = n === 1 ? "One" : String(n);
  return `${word} ${n === 1 ? one : many}`;
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
}
