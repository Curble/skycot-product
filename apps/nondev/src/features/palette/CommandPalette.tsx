// Cmd+K: a Spotlight-style sheet to jump somewhere. Grown-up only (see `paletteAvailable`):
// when it is not available nothing here mounts, so the shortcut is not even listened for.
import { useAtomValue } from "@effect/atom-react";
import { FilePlus2, Folder, MessageCircle, Search, Settings, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useShellState } from "../../app/ShellState";
import { useChildView } from "../../app/useChildView";
import { useColumns } from "../../app/useColumns";
import { HOME_HREF, navigate, useRoute } from "../../router";
import { conversationRowsAtom, projectKeyOf } from "../../state/conversations";
import { environmentProjects } from "../../state/projects";
import { useModal } from "../../ui/useModal";
import { useFamily } from "../family/FamilyProvider";
import {
  filterItems,
  isPaletteShortcut,
  moveSelection,
  paletteAvailable,
  paletteItems,
  type PaletteIcon,
  type PaletteItem,
} from "./palette";

const ICONS: Record<PaletteIcon, LucideIcon> = {
  new: FilePlus2,
  project: Folder,
  conversation: MessageCircle,
  files: Folder,
  settings: Settings,
};

export function CommandPaletteHost() {
  const childView = useChildView();
  const family = useFamily();
  if (!paletteAvailable({ childView, familyOn: family.enabled })) return null;
  return <CommandPalette />;
}

function CommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      setOpen((was) => !was);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return open ? <PaletteSheet onClose={() => setOpen(false)} /> : null;
}

function PaletteSheet({ onClose }: { readonly onClose: () => void }) {
  const shell = useShellState();
  const columns = useColumns();
  const route = useRoute();
  const rows = useAtomValue(conversationRowsAtom);
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useModal(sheetRef, { open: true, onClose, initialFocus: "first" });

  const items = useMemo(
    () =>
      filterItems(
        paletteItems({
          columns,
          projects: projects.map((project) => ({
            environmentId: project.environmentId,
            id: project.id,
            title: project.title,
            projectKey: projectKeyOf({
              environmentId: project.environmentId,
              projectId: project.id,
            }),
            ...(project.isScratch === true ? { isScratch: true } : {}),
          })),
          conversations: rows.map((row) => ({
            environmentId: row.shell.environmentId,
            id: row.shell.id,
            title: row.title,
            projectTitle: row.project?.title ?? null,
          })),
        }),
        query,
      ),
    [columns, projects, rows, query],
  );
  const selected = Math.min(at, Math.max(items.length - 1, 0));

  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  const choose = (item: PaletteItem) => {
    onClose();
    if (item.run.kind === "go") {
      navigate(item.run.href);
      return;
    }
    shell.setProjectKey(item.run.projectKey);
    const onConversations =
      route.name === "home" || route.name === "new" || route.name === "thread";
    if (!onConversations) navigate(HOME_HREF);
  };

  return createPortal(
    <div
      className="fm-sheet-backdrop fm-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search or jump to"
        tabIndex={-1}
        className="fm-palette"
      >
        <div className="fm-palette__field">
          <Search size={16} strokeWidth={1.8} aria-hidden />
          <input
            className="fm-palette__input"
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="fm-palette-list"
            aria-activedescendant={
              items[selected] ? `fm-palette-${items[selected]!.id}` : undefined
            }
            aria-label="Search or jump to"
            placeholder="Search or jump to…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setAt(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setAt(moveSelection(selected, items.length, event.key === "ArrowDown" ? 1 : -1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const item = items[selected];
                if (item) choose(item);
              }
            }}
          />
        </div>
        {items.length === 0 ? (
          <p className="fm-palette__empty">Nothing matches “{query.trim()}”.</p>
        ) : (
          <ul ref={listRef} id="fm-palette-list" className="fm-palette__list" role="listbox">
            {items.map((item, index) => {
              const Icon = ICONS[item.icon];
              return (
                <li
                  key={item.id}
                  id={`fm-palette-${item.id}`}
                  role="option"
                  aria-selected={index === selected}
                  className="fm-palette__row"
                  onMouseMove={() => setAt(index)}
                  onClick={() => choose(item)}
                >
                  <Icon size={16} strokeWidth={1.8} aria-hidden />
                  <span className="fm-palette__label">{item.label}</span>
                  {item.hint ? <span className="fm-palette__hint">{item.hint}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
