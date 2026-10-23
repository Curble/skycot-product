import { useAtomValue } from "@effect/atom-react";
import type { ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { Archive, Laptop, MessageSquareDashed, SquarePen } from "lucide-react";
import { useState, type MouseEvent } from "react";

import { Mascot } from "../features/brand/Mascot";
import { useChildFirst } from "../features/family-limits/useChildFirst";
import { navigate, threadHref } from "../router";
import { conversationRowsAtom, filterRows, type ConversationRow } from "../state/conversations";
import { oldConversationRowsAtom, oldConversationsLoadingAtom } from "../state/oldConversations";
import { environmentProjects } from "../state/projects";
import { Button, IconButton } from "../ui/Button";
import { ContextMenu, type MenuPoint } from "../ui/ContextMenu";
import { EmptyState } from "../ui/EmptyState";
import { SearchField } from "../ui/SearchField";
import {
  conversationPreview,
  dateGroup,
  formatRowTime,
  type DateGroup,
} from "../features/conversation/status";
import { startOneHint } from "../features/home/tip";
import { useStarters } from "../features/starters/StarterCards";
import { ConversationMenuButton, ConversationMenuItems } from "../features/tidy/ConversationMenu";
import { DeleteSheet } from "../features/tidy/DeleteSheet";
import { RenameSheet } from "../features/tidy/RenameSheet";
import { useTidy } from "../features/tidy/useTidy";
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
  const { kids } = useStarters();
  const old = shell.filter === "old";
  const liveRows = useAtomValue(conversationRowsAtom);
  const oldRows = useAtomValue(old ? oldConversationRowsAtom : EMPTY_ROWS_ATOM);
  const oldLoading = useAtomValue(old ? oldConversationsLoadingAtom : NOT_LOADING_ATOM);
  const rows = old ? oldRows : liveRows;
  const connected = useConnected();
  const projectCount = useAtomValue(environmentProjects.projectsAtom).length;
  const visible = filterRows(rows, old ? "all" : shell.filter, shell.projectKey, shell.search);
  const [renaming, setRenaming] = useState<ConversationRow | null>(null);
  const [deleting, setDeleting] = useState<ConversationRow | null>(null);
  const now = new Date();
  // With siblings, the child using SKYCOT sees their own conversations first.
  const split = useChildFirst(visible, (row) => row.shell.id);
  const sections: ReadonlyArray<{
    readonly key: string;
    readonly title: string | null;
    readonly rows: ReadonlyArray<ConversationRow>;
  }> =
    split === null
      ? [{ key: "all", title: null, rows: visible }]
      : [
          {
            key: "mine",
            title: split.mine.length > 0 && split.others.length > 0 ? split.title : null,
            rows: split.mine,
          },
          {
            key: "others",
            title: split.mine.length > 0 ? "Everyone else's" : null,
            rows: split.others,
          },
        ].filter((section) => section.rows.length > 0);
  // An empty list before the engine has answered is "not loaded", not "nothing".
  const waitingForData = rows.length === 0 && (!connected || (old && oldLoading));

  return (
    <section className="fm-list-column" aria-label="Conversations">
      <div className="fm-list-column__top">
        <h2 className="fm-list-column__title">
          <span className="fm-marker-underline">
            {shell.filter === "waiting"
              ? "Waiting for you"
              : shell.filter === "ready"
                ? "Ready to look at"
                : old
                  ? "Old conversations"
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
          <EmptyState icon={Laptop} title={old && connected ? "Looking…" : "Waiting for your Mac…"}>
            {old && connected ? null : "Your conversations appear as soon as it's reachable."}
          </EmptyState>
        ) : old && visible.length === 0 ? (
          <EmptyState
            icon={Archive}
            title={shell.search.trim() ? "Nothing matches" : "Nothing put away"}
          >
            {shell.search.trim()
              ? "Try a different word, or clear the search."
              : "Put a conversation away from its … menu to tidy the list. It waits here, with everything in it, until you bring it back."}
          </EmptyState>
        ) : rows.length === 0 && projectCount === 0 ? (
          <EmptyState art={<Mascot pose="hello" size={72} />} title="No projects yet">
            Open a folder in the sidebar, the one that holds your website or app, then say what
            you'd like done.
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState
            {...(shell.filter === "all" && shell.search.trim().length === 0
              ? { art: <Mascot pose="hello" size={72} /> }
              : { icon: MessageSquareDashed })}
            title={emptyTitle(shell.filter, shell.search)}
          >
            {emptyText(shell.filter, shell.search, rows.length, crew.builder.name, kids)}
          </EmptyState>
        ) : (
          <>
            {old ? (
              <p className="fm-list-column__note">
                Put away, not deleted. Everything in them is kept, and they still count on the
                fridge and for stickers.
              </p>
            ) : null}
            {sections.map((section) => {
              const groups = new Map<DateGroup, ConversationRow[]>();
              for (const row of section.rows) {
                const group = dateGroup(row.at, now);
                const list = groups.get(group);
                if (list) list.push(row);
                else groups.set(group, [row]);
              }
              return (
                <div key={section.key}>
                  {section.title ? (
                    <div className="fm-list-column__section">{section.title}</div>
                  ) : null}
                  {GROUP_ORDER.filter((group) => groups.has(group)).map((group) => (
                    <div key={group}>
                      <div className="fm-list-column__group">{group}</div>
                      {groups.get(group)!.map((row) => (
                        <ConversationRowItem
                          key={`${row.shell.environmentId}:${row.shell.id}`}
                          row={row}
                          archived={old}
                          preview={conversationPreview(row.shell, row.status, crew.builder.name)}
                          selected={row.shell.id === selectedThreadId}
                          now={now}
                          onRename={() => setRenaming(row)}
                          onDelete={() => setDeleting(row)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
          </>
        )}
      </div>
      <RenameSheet
        shell={renaming?.shell ?? null}
        currentTitle={renaming?.title ?? ""}
        archived={old}
        onClose={() => setRenaming(null)}
      />
      <DeleteSheet
        shell={deleting?.shell ?? null}
        currentTitle={deleting?.title ?? ""}
        archived={old}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

const EMPTY_ROWS_ATOM = Atom.make<ReadonlyArray<ConversationRow>>([]).pipe(
  Atom.withLabel("nondev-conversation-rows:empty"),
);
const NOT_LOADING_ATOM = Atom.make(false).pipe(Atom.withLabel("nondev-not-loading"));

/**
 * One row with its menu: "…" (or a right-click) for Rename…, Put away and Delete…; an old
 * conversation's row has Bring back under its words, and its "…" has Bring back and Delete….
 */
function ConversationRowItem({
  row,
  archived,
  preview,
  selected,
  now,
  onRename,
  onDelete,
}: {
  readonly row: ConversationRow;
  readonly archived: boolean;
  readonly preview: string;
  readonly selected: boolean;
  readonly now: Date;
  readonly onRename: () => void;
  readonly onDelete: () => void;
}) {
  const tidy = useTidy();
  const [menuAt, setMenuAt] = useState<MenuPoint | null>(null);
  const [bringing, setBringing] = useState(false);
  const openMenu = (event: MouseEvent) => {
    event.preventDefault();
    setMenuAt({ x: event.clientX, y: event.clientY });
  };
  return (
    <div
      className={`fm-convrow-item${archived ? " fm-convrow-item--old" : ""}${
        menuAt ? " fm-convrow-item--menu" : ""
      }`}
      onContextMenu={openMenu}
    >
      <ConversationRowButton row={row} preview={preview} selected={selected} now={now} />
      {archived ? (
        <span className="fm-convrow-item__bring">
          <Button
            size="sm"
            disabled={bringing}
            onClick={async () => {
              setBringing(true);
              const outcome = await tidy.bringBack(row.shell);
              if (!outcome.ok) setBringing(false);
            }}
          >
            {bringing ? "Bringing back…" : "Bring back"}
          </Button>
        </span>
      ) : null}
      <span className="fm-convrow-item__more">
        <ConversationMenuButton
          shell={row.shell}
          archived={archived}
          onRename={onRename}
          onDelete={onDelete}
          size="sm"
        />
      </span>
      <ContextMenu at={menuAt} onClose={() => setMenuAt(null)} label={`${row.title}`}>
        {(close) => (
          <ConversationMenuItems
            shell={row.shell}
            archived={archived}
            onRename={onRename}
            onDelete={onDelete}
            close={close}
          />
        )}
      </ContextMenu>
    </div>
  );
}

function emptyTitle(filter: string, search: string): string {
  if (search.trim().length > 0) return "Nothing matches";
  if (filter === "waiting") return "Nothing is waiting on you";
  if (filter === "ready") return "Nothing new to look at";
  return "No conversations yet";
}

function emptyText(
  filter: string,
  search: string,
  total: number,
  crewName: string,
  kids: boolean,
): string {
  if (search.trim().length > 0) return "Try a different word, or clear the search.";
  if (filter !== "all") return `You'll see a dot here when ${crewName} needs you.`;
  return total === 0
    ? startOneHint(kids)
    : "Start one below: say what you'd like done in this project.";
}

function ConversationRowButton({
  row,
  preview,
  selected,
  now,
}: {
  readonly row: ConversationRow;
  /** The row's last line, in the theme's crew name ("Sam: …" in Workshop). */
  readonly preview: string;
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
          {preview}
        </span>
      </span>
    </button>
  );
}
