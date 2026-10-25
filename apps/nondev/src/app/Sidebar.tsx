import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import {
  Archive,
  BookOpen,
  Bell,
  Blocks,
  CheckCircle2,
  CircleAlert,
  FolderPlus,
  MessageCircle,
  Home,
  PanelLeftOpen,
  Refrigerator,
  Sticker as StickerOutline,
  Settings,
  User,
  Wrench,
} from "lucide-react";
import { ADVANCED_MODE_LABEL } from "../brand";
import { useChildView } from "./useChildView";
import {
  AUTOMATIONS_HREF,
  FRIDGE_HREF,
  STICKERS_HREF,
  HOME_HREF,
  PEOPLE_HREF,
  SETTINGS_HREF,
  navigate,
  type Route,
} from "../router";
import { threadHref } from "../router";
import { enabledEnvironmentIdsAtom } from "../state/catalog";
import { conversationRowsAtom, projectKeyOf, type ConversationRow } from "../state/conversations";
import { environmentProjects } from "../state/projects";
import { oldConversationRowsAtom } from "../state/oldConversations";
import { CrewAvatar } from "../themes/CrewAvatar";
import { useCrew } from "../themes/useCrew";
import { Avatar } from "../ui/Avatar";
import { Button, IconButton } from "../ui/Button";
import { ContextMenu, type MenuPoint } from "../ui/ContextMenu";
import { SidebarItem, SidebarSection } from "../ui/Sidebar";
import { ProjectAvatar } from "./ProjectAvatar";
import { useShellState } from "./ShellState";
import { useSidebarSheets } from "./SidebarSheets";
import { useFamily } from "../features/family/FamilyProvider";
import { currentChild } from "../features/family/family";
import { ChildAvatar } from "../features/family/ChildAvatar";
import { openChildPicker } from "../features/family-limits/FamilyLimitsHost";
import type { FamilyChild } from "../features/family/children";
import { FridgeIcon } from "../features/fridge/FridgeIcon";
import { Sticker } from "../features/badges/stickers/Sticker";
import { ProjectMenuButton, ProjectMenuItems } from "../features/projects/ProjectMenu";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

const NO_CHILD_ARCHIVE_ROWS = Atom.make<ReadonlyArray<ConversationRow>>([]).pipe(
  Atom.withLabel("nondev-child-sidebar:no-archive-rows"),
);

/** Source list: smart folders, projects, automations, people, then the user and the Advanced mode button. */
export function AppSidebar({
  route,
  onNavigate,
  insideMake = false,
}: {
  readonly route: Route;
  /** Called after any selection so a drawer can close itself. */
  readonly onNavigate?: () => void;
  readonly insideMake?: boolean;
}) {
  const shell = useShellState();
  const rows = useAtomValue(conversationRowsAtom);
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const sheets = useSidebarSheets();
  const crew = useCrew();
  const family = useFamily();
  const childView = useChildView();
  const archivedChildRows = useAtomValue(
    childView ? oldConversationRowsAtom : NO_CHILD_ARCHIVE_ROWS,
  );
  const [projectMenu, setProjectMenu] = useState<{
    readonly project: EnvironmentProject;
    readonly at: MenuPoint;
  } | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const railToggle = useRef<HTMLButtonElement>(null);
  const railPanel = useRef<HTMLElement>(null);
  const openedRail = useRef(false);
  const closeProjectMenu = useCallback(() => setProjectMenu(null), []);

  const waiting = rows.filter((row) => row.status.attention === "waiting").length;
  const ready = rows.filter((row) => row.status.kind === "ready").length;
  const childMakes = [...rows, ...(childView ? archivedChildRows : [])].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  );
  const countsByProject = new Map<string, number>();
  const attentionByProject = new Set<string>();
  for (const row of rows) {
    const key = row.projectKey;
    countsByProject.set(key, (countsByProject.get(key) ?? 0) + 1);
    if (row.status.attention === "waiting") attentionByProject.add(key);
  }

  const primaryEnvironmentId: EnvironmentId | undefined = environmentIds[0];
  // The Mac's own name ("MamaBear") is not a person, and a child should never see it.
  const child = currentChild(family.profile);
  const conversationRoute =
    route.name === "home" || route.name === "new" || route.name === "thread";

  const select = (apply: () => void) => {
    apply();
    if (insideMake) setRailOpen(false);
    onNavigate?.();
  };
  // Filters and projects describe the conversation list, so choosing one from
  // Settings, Automations or People also goes back to that list.
  const showList = (apply: () => void) =>
    select(() => {
      apply();
      if (!conversationRoute) navigate(HOME_HREF);
    });

  useEffect(() => {
    if (!insideMake) return;
    if (!railOpen) {
      if (openedRail.current) {
        openedRail.current = false;
        requestAnimationFrame(() => railToggle.current?.focus());
      }
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRailOpen(false);
        railToggle.current?.focus();
      }
    };
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !railPanel.current?.contains(event.target) &&
        !railToggle.current?.contains(event.target)
      ) {
        setRailOpen(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [insideMake, railOpen]);

  if (childView && insideMake && !railOpen) {
    return (
      <nav className="fm-child-rail" aria-label="Child navigation">
        <button
          ref={railToggle}
          type="button"
          className="fm-child-rail__toggle"
          aria-label="Show sidebar"
          title="Show sidebar"
          aria-expanded={false}
          aria-controls="fm-child-sidebar"
          onClick={() => {
            openedRail.current = true;
            setRailOpen(true);
          }}
        >
          <PanelLeftOpen size={20} strokeWidth={1.9} />
        </button>
        <a
          className="fm-child-rail__item"
          href={HOME_HREF}
          title="Home"
          onClick={(event) => {
            event.preventDefault();
            navigate(HOME_HREF);
          }}
        >
          <span className="fm-child-rail__tile fm-child-rail__tile--home" aria-hidden>
            <Home size={24} strokeWidth={2} />
          </span>
          <span>Home</span>
        </a>
        {/* Inside a make, so My makes is where the child is. */}
        <button
          type="button"
          className="fm-child-rail__item fm-child-rail__item--current"
          aria-current="page"
          title="My makes"
          onClick={() => {
            openedRail.current = true;
            setRailOpen(true);
          }}
        >
          <span className="fm-child-rail__tile fm-child-rail__tile--makes" aria-hidden>
            <Blocks size={24} strokeWidth={2} />
          </span>
          <span>My makes</span>
        </button>
        <a
          className="fm-child-rail__item"
          href={FRIDGE_HREF}
          title="The fridge"
          onClick={(event) => {
            event.preventDefault();
            navigate(FRIDGE_HREF);
          }}
        >
          <span className="fm-child-rail__tile fm-child-rail__tile--fridge" aria-hidden>
            <Refrigerator size={24} strokeWidth={2} />
          </span>
          <span>Fridge</span>
        </a>
        <a
          className="fm-child-rail__item"
          href={STICKERS_HREF}
          title="My stickers"
          onClick={(event) => {
            event.preventDefault();
            navigate(STICKERS_HREF);
          }}
        >
          <span className="fm-child-rail__tile fm-child-rail__tile--stickers" aria-hidden>
            <StickerOutline size={24} strokeWidth={2} />
          </span>
          <span>Stickers</span>
        </a>
        {child ? (
          <span className="fm-child-rail__avatar" title={child.name ?? undefined}>
            <ChildAvatar child={child} size={40} />
          </span>
        ) : null}
      </nav>
    );
  }

  return (
    <nav
      id={childView && insideMake ? "fm-child-sidebar" : undefined}
      ref={railPanel}
      className={`fm-sidebar${childView && insideMake ? " fm-sidebar--child-overlay" : ""}`}
      aria-label="Sidebar"
    >
      {childView && insideMake ? (
        <button
          className="fm-child-rail__close"
          type="button"
          aria-label="Close navigation"
          aria-expanded={true}
          aria-controls="fm-child-sidebar"
          onClick={() => setRailOpen(false)}
        >
          Close navigation
        </button>
      ) : null}
      <div className="fm-sidebar__scroll">
        <SidebarSection>
          {childView ? (
            <>
              <SidebarItem
                icon={Home}
                label="Home"
                selected={route.name === "home"}
                href={HOME_HREF}
              />
              <ChildMakesList
                rows={childMakes}
                onOpen={(row) =>
                  select(() => navigate(threadHref(row.shell.environmentId, row.shell.id)))
                }
              />
            </>
          ) : (
            <>
              <SidebarItem
                icon={MessageCircle}
                label="All conversations"
                count={rows.length}
                selected={conversationRoute && shell.filter === "all" && shell.projectKey === null}
                onClick={() => showList(() => shell.setFilter("all"))}
              />
              <SidebarItem
                icon={CircleAlert}
                label="Waiting for you"
                count={waiting}
                selected={conversationRoute && shell.filter === "waiting"}
                onClick={() => showList(() => shell.setFilter("waiting"))}
              />
              <SidebarItem
                icon={CheckCircle2}
                label="Ready to look at"
                count={ready}
                selected={conversationRoute && shell.filter === "ready"}
                onClick={() => showList(() => shell.setFilter("ready"))}
              />
              <SidebarItem
                icon={Archive}
                label="Old conversations"
                selected={conversationRoute && shell.filter === "old"}
                onClick={() => showList(() => shell.setFilter("old"))}
              />
            </>
          )}
          <SidebarItem
            glyph={<FridgeIcon size={15} />}
            label="The fridge"
            selected={route.name === "fridge"}
            href={FRIDGE_HREF}
          />
          <SidebarItem
            glyph={<Sticker id="first-creation" size={18} tilted={false} />}
            label="My stickers"
            selected={route.name === "stickers" || route.name === "certificate"}
            href={STICKERS_HREF}
          />
        </SidebarSection>

        {showSidebarProjects(childView, projects.length) ? (
          <SidebarSection title="Projects">
            {/* Questions (Just ask) first: it is SKYCOT's own space, not one of the person's folders. */}
            {[...projects]
              .sort((a, b) => Number(b.isScratch === true) - Number(a.isScratch === true))
              .map((project) => {
                const key = projectKeyOf({
                  environmentId: project.environmentId,
                  projectId: project.id,
                });
                return (
                  <SidebarItem
                    key={key}
                    glyph={<ProjectAvatar project={project} size="sm" />}
                    label={project.title}
                    count={countsByProject.get(key) ?? 0}
                    attention={attentionByProject.has(key)}
                    selected={conversationRoute && shell.projectKey === key}
                    onClick={() => showList(() => shell.setProjectKey(key))}
                    // Questions is SKYCOT's own space: nothing to rename or re-icon.
                    {...(project.isScratch === true
                      ? {}
                      : {
                          menuOpen: projectMenu?.project === project,
                          onContextMenu: (event: MouseEvent) => {
                            event.preventDefault();
                            setProjectMenu({ project, at: { x: event.clientX, y: event.clientY } });
                          },
                          trailing: (
                            <ProjectMenuButton
                              project={project}
                              expanded={projectMenu?.project === project}
                              onOpen={(at) => setProjectMenu({ project, at })}
                            />
                          ),
                        })}
                  />
                );
              })}
            {!childView ? (
              <SidebarItem
                icon={FolderPlus}
                label="Open a folder…"
                muted
                onClick={() => {
                  if (!primaryEnvironmentId) return;
                  const environmentId = primaryEnvironmentId;
                  sheets.openFolder({
                    environmentId,
                    onOpened: (projectId) =>
                      showList(() =>
                        shell.setProjectKey(projectKeyOf({ environmentId, projectId })),
                      ),
                  });
                }}
              />
            ) : null}
          </SidebarSection>
        ) : null}

        {crew.named && !childView ? (
          <SidebarSection title="Your crew">
            <li className="fm-crew-roster">
              <CrewAvatar role="builder" size="md" />
              <span className="fm-crew-roster__text">
                <b>{crew.builder.name}</b>
                <small>builds things</small>
              </span>
            </li>
            <li className="fm-crew-roster">
              <CrewAvatar role="checker" size="md" />
              <span className="fm-crew-roster__text">
                <b>{crew.checker.name}</b>
                <small>checks before anything goes live</small>
              </span>
            </li>
          </SidebarSection>
        ) : null}

        {!childView ? (
          <SidebarSection title="Automations">
            <SidebarItem
              icon={Bell}
              label="Automations"
              selected={route.name === "automations"}
              href={AUTOMATIONS_HREF}
            />
          </SidebarSection>
        ) : null}

        {!childView ? (
          <SidebarSection title="People">
            <SidebarItem
              icon={User}
              label="Who can help"
              selected={route.name === "people"}
              href={PEOPLE_HREF}
            />
          </SidebarSection>
        ) : null}
      </div>

      <ContextMenu
        at={projectMenu?.at ?? null}
        onClose={closeProjectMenu}
        label={projectMenu?.project.title ?? "Project"}
      >
        {(close) =>
          projectMenu ? (
            <ProjectMenuItems
              close={close}
              onEdit={(focus) => sheets.editProject(projectMenu.project, focus)}
            />
          ) : null
        }
      </ContextMenu>

      <footer className="fm-sidebar__footer">
        <div className="fm-sidebar__footer-row">
          <SidebarIdentity
            familyOn={family.enabled}
            childView={childView}
            child={child}
            onSwitch={openChildPicker}
          />
          {childView ? (
            <IconButton
              icon={Settings}
              label="Settings"
              size="sm"
              onClick={sheets.openChildSettings}
            />
          ) : (
            <IconButton
              icon={Settings}
              label="Settings"
              size="sm"
              aria-current={route.name === "settings" ? "page" : undefined}
              onClick={() => select(() => navigate(SETTINGS_HREF))}
            />
          )}
        </div>
        {/* The Family profile keeps the developer tools out of reach; Settings › Family has the parent's way in. */}
        {family.enabled ? null : (
          <div className="fm-sidebar__footer-row">
            {/* A button, not a switch: nothing stays "on"; it opens the confirm sheet. */}
            <Button size="sm" variant="quiet" icon={Wrench} block onClick={sheets.openAdvanced}>
              Open {ADVANCED_MODE_LABEL}…
            </Button>
          </div>
        )}
      </footer>
    </nav>
  );
}

/** Who the footer stands for: the grown-up whose settings the gear opens, never the computer. */
export function sidebarPersonLabel(familyOn: boolean): string {
  return familyOn ? "Grown-up" : "You";
}

export function showSidebarProjects(childView: boolean, projectCount: number): boolean {
  return !childView || projectCount > 1;
}

export function childMakeBadge(
  status: { readonly kind: string; readonly headline?: string },
  at: string,
): string {
  if (status.kind === "ready") return "Ready to look at";
  if (status.kind === "waiting") {
    // "Waiting" is four things; only one of them is a grown-up.
    const headline = status.headline ?? "";
    if (/grown-up/i.test(headline)) return "Waiting for a grown-up";
    if (/plan/i.test(headline)) return "Press Build it";
    return "A question for you";
  }
  if (status.kind === "working" || status.kind === "preparing") return "Building now";
  const days = Math.floor((Date.now() - Date.parse(at)) / 86_400_000);
  return days < 1 ? "Made today" : days < 2 ? "Made yesterday" : `Made ${days} days ago`;
}

export function ChildMakesList({
  rows,
  onOpen,
}: {
  readonly rows: ReadonlyArray<ConversationRow>;
  readonly onOpen: (row: ConversationRow) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  return (
    <li className="fm-child-makes">
      <div className="fm-child-makes__heading">
        My makes <span>{rows.length}</span>
      </div>
      {(showAll ? rows : rows.slice(0, 6)).map((row) => (
        <button
          className="fm-child-makes__row"
          type="button"
          key={row.shell.id}
          onClick={() => onOpen(row)}
        >
          <span className="fm-child-makes__title">{row.title}</span>
          <small>{childMakeBadge(row.status, row.at)}</small>
        </button>
      ))}
      {rows.length > 6 ? (
        <button
          className="fm-child-makes__all"
          type="button"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? "Show fewer makes" : `Show all ${rows.length} makes`}
        </button>
      ) : null}
    </li>
  );
}

export function SidebarIdentity({
  familyOn,
  childView,
  child,
  onSwitch,
}: {
  readonly familyOn: boolean;
  readonly childView: boolean;
  readonly child: FamilyChild | null;
  readonly onSwitch: () => void;
}) {
  const label = sidebarPersonLabel(familyOn);
  return (
    <>
      <span className="fm-sidebar__me">
        {childView && child ? (
          <ChildAvatar child={child} size={24} />
        ) : (
          <Avatar kind="person" value={label} size="sm" label={label} />
        )}
        <b>{childView ? (child?.name ?? "You") : label}</b>
      </span>
      {childView ? (
        <Button size="sm" variant="quiet" onClick={onSwitch}>
          Switch
        </Button>
      ) : null}
    </>
  );
}
