import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  Bell,
  CheckCircle2,
  CircleAlert,
  FolderPlus,
  MessageCircle,
  Settings,
  User,
} from "lucide-react";
import { useId, useState } from "react";

import { ADVANCED_MODE_LABEL } from "../brand";
import { AUTOMATIONS_HREF, PEOPLE_HREF, SETTINGS_HREF, navigate, type Route } from "../router";
import { enabledEnvironmentIdsAtom, environmentCatalog } from "../state/catalog";
import { conversationRowsAtom, projectKeyOf } from "../state/conversations";
import { environmentProjects } from "../state/projects";
import { Avatar } from "../ui/Avatar";
import { IconButton } from "../ui/Button";
import { SidebarItem, SidebarSection } from "../ui/Sidebar";
import { Switch } from "../ui/Switch";
import { AdvancedModeSheet } from "./AdvancedModeSheet";
import { OpenFolderSheet } from "./OpenFolderSheet";
import { ProjectAvatar } from "./ProjectAvatar";
import { useShellState } from "./ShellState";

/** Source list: smart folders, projects, automations, people, then the user and the Advanced switch. */
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
  const [folderSheetOpen, setFolderSheetOpen] = useState(false);
  const [advancedSheetOpen, setAdvancedSheetOpen] = useState(false);
  const advancedLabelId = useId();

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

  return (
    <nav className="fm-sidebar" aria-label="Sidebar">
      <div className="fm-sidebar__scroll">
        <SidebarSection>
          <SidebarItem
            icon={MessageCircle}
            label="All conversations"
            count={rows.length}
            selected={conversationRoute && shell.filter === "all" && shell.projectKey === null}
            onClick={() => select(() => shell.setFilter("all"))}
          />
          <SidebarItem
            icon={CircleAlert}
            label="Waiting for you"
            count={waiting}
            selected={conversationRoute && shell.filter === "waiting"}
            onClick={() => select(() => shell.setFilter("waiting"))}
          />
          <SidebarItem
            icon={CheckCircle2}
            label="Ready to look at"
            count={ready}
            selected={conversationRoute && shell.filter === "ready"}
            onClick={() => select(() => shell.setFilter("ready"))}
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
                onClick={() => select(() => shell.setProjectKey(key))}
              />
            );
          })}
          <SidebarItem
            icon={FolderPlus}
            label="Open a folder…"
            muted
            onClick={() => setFolderSheetOpen(true)}
          />
        </SidebarSection>

        <SidebarSection title="Automations">
          <SidebarItem
            icon={Bell}
            label="Scheduled jobs"
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
        <div className="fm-sidebar__footer-row">
          <span id={advancedLabelId}>
            {ADVANCED_MODE_LABEL}
            <span className="fm-sidebar__footer-sub">developer tools</span>
          </span>
          <Switch
            checked={advancedSheetOpen}
            onChange={(next) => setAdvancedSheetOpen(next)}
            label={ADVANCED_MODE_LABEL}
            labelledBy={advancedLabelId}
          />
        </div>
      </footer>

      {primaryEnvironmentId ? (
        <OpenFolderSheet
          open={folderSheetOpen}
          onClose={() => setFolderSheetOpen(false)}
          environmentId={primaryEnvironmentId}
          onOpened={(projectId) =>
            select(() =>
              shell.setProjectKey(projectKeyOf({ environmentId: primaryEnvironmentId, projectId })),
            )
          }
        />
      ) : null}
      <AdvancedModeSheet open={advancedSheetOpen} onClose={() => setAdvancedSheetOpen(false)} />
    </nav>
  );
}
