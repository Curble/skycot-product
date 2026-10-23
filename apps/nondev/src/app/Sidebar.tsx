import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  Archive,
  Bell,
  CheckCircle2,
  CircleAlert,
  FolderPlus,
  MessageCircle,
  Settings,
  User,
  Wrench,
} from "lucide-react";
import { ADVANCED_MODE_LABEL } from "../brand";
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
import { enabledEnvironmentIdsAtom, environmentCatalog } from "../state/catalog";
import { conversationRowsAtom, projectKeyOf } from "../state/conversations";
import { environmentProjects } from "../state/projects";
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
import { FridgeIcon } from "../features/fridge/FridgeIcon";
import { Sticker } from "../features/badges/stickers/Sticker";
import { ProjectMenuButton, ProjectMenuItems } from "../features/projects/ProjectMenu";
import { useCallback, useState } from "react";

/** Source list: smart folders, projects, automations, people, then the user and the Advanced mode button. */
export function AppSidebar({
  route,
  onNavigate,
}: {
  readonly route: Route;
  /** Called after any selection so a drawer can close itself. */
  readonly onNavigate?: () => void;
}) {
  const shell = useShellState();
  const rows = useAtomValue(conversationRowsAtom);
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const sheets = useSidebarSheets();
  const crew = useCrew();
  const family = useFamily();
  const [projectMenu, setProjectMenu] = useState<{
    readonly project: EnvironmentProject;
    readonly at: MenuPoint;
  } | null>(null);
  const closeProjectMenu = useCallback(() => setProjectMenu(null), []);

  const waiting = rows.filter((row) => row.status.attention === "waiting").length;
  const ready = rows.filter((row) => row.status.kind === "ready").length;
  const countsByProject = new Map<string, number>();
  const attentionByProject = new Set<string>();
  for (const row of rows) {
    const key = projectKeyOf(row.shell);
    countsByProject.set(key, (countsByProject.get(key) ?? 0) + 1);
    if (row.status.attention === "waiting") attentionByProject.add(key);
  }

  const conversationRoute =
    route.name === "home" || route.name === "new" || route.name === "thread";
  const primaryEnvironmentId: EnvironmentId | undefined = environmentIds[0];
  const environmentLabel = primaryEnvironmentId
    ? (catalog.entries.get(primaryEnvironmentId)?.target.label ?? "This Mac")
    : "This Mac";

  const select = (apply: () => void) => {
    apply();
    onNavigate?.();
  };
  // Filters and projects describe the conversation list, so choosing one from
  // Settings, Automations or People also goes back to that list.
  const showList = (apply: () => void) =>
    select(() => {
      apply();
      if (!conversationRoute) navigate(HOME_HREF);
    });

  return (
    <nav className="fm-sidebar" aria-label="Sidebar">
      <div className="fm-sidebar__scroll">
        <SidebarSection>
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

        <SidebarSection title="Projects">
          {projects.map((project) => {
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
                menuOpen={projectMenu?.project === project}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setProjectMenu({ project, at: { x: event.clientX, y: event.clientY } });
                }}
                trailing={
                  <ProjectMenuButton
                    project={project}
                    expanded={projectMenu?.project === project}
                    onOpen={(at) => setProjectMenu({ project, at })}
                  />
                }
              />
            );
          })}
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
                  showList(() => shell.setProjectKey(projectKeyOf({ environmentId, projectId }))),
              });
            }}
          />
        </SidebarSection>

        {crew.named ? (
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

        <SidebarSection title="Automations">
          <SidebarItem
            icon={Bell}
            label="Automations"
            selected={route.name === "automations"}
            href={AUTOMATIONS_HREF}
          />
        </SidebarSection>

        <SidebarSection title="People">
          <SidebarItem
            icon={User}
            label="Who can help"
            selected={route.name === "people"}
            href={PEOPLE_HREF}
          />
        </SidebarSection>
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
          <span className="fm-sidebar__me">
            <Avatar kind="person" value={environmentLabel} size="sm" label={environmentLabel} />
            <b>{environmentLabel}</b>
          </span>
          <IconButton
            icon={Settings}
            label="Settings"
            size="sm"
            aria-current={route.name === "settings" ? "page" : undefined}
            onClick={() => select(() => navigate(SETTINGS_HREF))}
          />
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
