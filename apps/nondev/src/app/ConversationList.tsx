import { useAtomValue } from "@effect/atom-react";
import type { ThreadId } from "@t3tools/contracts";
import { Laptop, MessageSquareDashed, SquarePen } from "lucide-react";

import { navigate, threadHref } from "../router";
import { conversationRowsAtom, filterRows, type ConversationRow } from "../state/conversations";
import { IconButton } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { SearchField } from "../ui/SearchField";
import { dateGroup, formatRowTime, type DateGroup } from "../features/conversation/status";
import { useCrew } from "../themes/useCrew";
import { ProjectAvatar } from "./ProjectAvatar";
import { useShellState } from "./ShellState";
import { useConnected } from "./useConnection";
import type { Columns } from "./useColumns";

const GROUP_ORDER: ReadonlyArray<DateGroup> = ["Today", "Yesterday", "This week", "Earlier"];

/** The middle column: every conversation, grouped by day, filtered by the sidebar and search. */
export function ConversationList({
  columns,
  selectedThreadId,
  onCompose,
}: {
  readonly columns: Columns;
  readonly selectedThreadId: ThreadId | null;
  readonly onCompose: () => void;
}) {
  const shell = useShellState();
  const crew = useCrew();
  const rows = useAtomValue(conversationRowsAtom);
  const connected = useConnected();
  const visible = filterRows(rows, shell.filter, shell.projectKey, shell.search);
  const now = new Date();
  const groups = new Map<DateGroup, ConversationRow[]>();
  for (const row of visible) {
    const group = dateGroup(row.at, now);
    const list = groups.get(group);
    if (list) list.push(row);
    else groups.set(group, [row]);
  }
  // An empty list before the engine has answered is "not loaded", not "nothing".
  const waitingForData = rows.length === 0 && !connected;

  return (
    <section className="fm-list-column" aria-label="Conversations">
      <div className="fm-list-column__top">
        <h2 className="fm-list-column__title">
          <span className="fm-marker-underline">
            {shell.filter === "waiting"
              ? "Waiting for you"
              : shell.filter === "ready"
                ? "Ready to look at"
                : "Conversations"}
          </span>
        </h2>
        <IconButton icon={SquarePen} label="New conversation" onClick={onCompose} />
      </div>
      {columns === 1 ? (
        <div className="fm-list-column__search">
          <SearchField
            value={shell.search}
            onChange={shell.setSearch}
            placeholder="Search"
            label="Search conversations"
          />
        </div>
      ) : null}
      <div className="fm-list-column__scroll">
        {waitingForData ? (
          <EmptyState icon={Laptop} title="Waiting for your Mac…">
            Your conversations appear as soon as it's reachable.
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState icon={MessageSquareDashed} title={emptyTitle(shell.filter, shell.search)}>
            {emptyText(shell.filter, shell.search, rows.length, crew.builder.name)}
          </EmptyState>
        ) : (
          GROUP_ORDER.filter((group) => groups.has(group)).map((group) => (
            <div key={group}>
              <div className="fm-list-column__group">{group}</div>
              {groups.get(group)!.map((row) => (
                <ConversationRowButton
                  key={`${row.shell.environmentId}:${row.shell.id}`}
                  row={row}
                  selected={row.shell.id === selectedThreadId}
                  now={now}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function emptyTitle(filter: string, search: string): string {
  if (search.trim().length > 0) return "Nothing matches";
  if (filter === "waiting") return "Nothing is waiting on you";
  if (filter === "ready") return "Nothing new to look at";
  return "No conversations yet";
}

function emptyText(filter: string, search: string, total: number, crewName: string): string {
  if (search.trim().length > 0) return "Try a different word, or clear the search.";
  if (filter !== "all") return `You'll see a dot here when ${crewName} needs you.`;
  return total === 0
    ? "Start one below: say what you'd like done, like you'd text a staff member."
    : "";
}

function ConversationRowButton({
  row,
  selected,
  now,
}: {
  readonly row: ConversationRow;
  readonly selected: boolean;
  readonly now: Date;
}) {
  const dotClass =
    row.status.attention === "waiting"
      ? "fm-convrow__dot fm-convrow__dot--waiting"
      : row.status.attention === "ready"
        ? "fm-convrow__dot fm-convrow__dot--attention"
        : "fm-convrow__dot";
  return (
    <button
      type="button"
      className={`fm-convrow${selected ? " fm-convrow--selected" : ""}`}
      aria-current={selected ? "page" : undefined}
      onClick={() => navigate(threadHref(row.shell.environmentId, row.shell.id))}
    >
      <span
        className={dotClass}
        role={row.status.attention === "none" ? undefined : "img"}
        aria-label={
          row.status.attention === "waiting"
            ? "Waiting for you"
            : row.status.attention === "ready"
              ? "Ready to look at"
              : undefined
        }
      />
      <ProjectAvatar project={row.project} size="xl" />
      <span className="fm-convrow__body">
        <span className="fm-convrow__head">
          <span className="fm-convrow__title">{row.title}</span>
          <span className="fm-convrow__time">{formatRowTime(row.at, now)}</span>
        </span>
        <span className="fm-convrow__preview">
          {row.project && row.title !== row.project.title ? `${row.project.title} · ` : ""}
          {row.preview}
        </span>
      </span>
    </button>
  );
}
