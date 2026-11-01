import { useAtomValue } from "@effect/atom-react";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  OrchestrationV2ThreadShell,
  ServerConfig,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { documentTitle } from "../brand";
// Side effect: registers the "What changed" card for checkpoint turn items.
import "../features/review";
import { useFamily } from "../features/family/FamilyProvider";
import { FamilyHeadsUp } from "../features/family-limits/HeadsUp";
import { CommandPaletteHost } from "../features/palette/CommandPalette";
import { NotificationCoordinator } from "../features/notifications/NotificationCoordinator";
import { PreviewPanel } from "../features/preview/PreviewPanel";
import {
  closePreview,
  shouldClosePreviewOnRouteChange,
  usePreviewElsewhere,
  usePreviewOpen,
} from "../features/preview/store";
import { catalogEntryFor } from "../features/settings/providerCatalog";
import { ReadyNotifier } from "../features/updates/ReadyNotifier";
import { UpdatePill } from "../features/updates/UpdatePill";
import { UsageBanner } from "../features/usage/UsageBanner";
import { UsageIndicator } from "../features/usage/UsagePopover";
import { UsageSheetHost } from "../features/usage/UsageSheet";
import { sectionLabel } from "../features/settings/sections";
import {
  useRoomForRail,
  useVersionsRailOpen,
  VersionsRailSlot,
  versionsRailMode,
} from "../features/versions";
import { HOME_HREF, NEW_HREF, navigate, type Route } from "../router";
import { enabledEnvironmentIdsAtom } from "../state/catalog";
import { environmentProjects, projectAtomOrEmpty } from "../state/projects";
import { projectForConversation } from "../features/questions/questions";
import { useDefaultAssistantPreference } from "../state/defaultAssistant";
import { resolveDefaultModelSelection, providerForSelection } from "../state/providers";
import { serverEnvironment } from "../state/server";
import { environmentThreadShells } from "../state/threads";
import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";
import { ToastHost } from "../ui/Toast";
import { useModal } from "../ui/useModal";
import { ConnectionBanner } from "./ConnectionBanner";
import { ConversationList } from "./ConversationList";
import { AppSidebar } from "./Sidebar";
import { ShellStateProvider, useShellState } from "./ShellState";
import { TitleBar } from "./TitleBar";
import { useColumns, type Columns } from "./useColumns";
import { useChildView } from "./useChildView";
import { openChildPicker } from "../features/family-limits/FamilyLimitsHost";
import { APP_VERSION } from "~/branding";
import { canReloadForEngineUpdate, clientBundleStamp, engineBuildIsNewer } from "./engineUpdate";

const EMPTY_CONFIG_ATOM = Atom.make<ServerConfig | null>(null).pipe(
  Atom.withLabel("nondev-app-shell:empty-config"),
);

/**
 * The Messages window. Decides which columns exist at this width and which
 * screen the single column shows on a phone:
 *   home        → the list (3/2 columns: list + Home pane)
 *   new         → the compose/Home pane
 *   thread      → the conversation, with a back button
 */
export function AppShell({
  route,
  children,
}: {
  readonly route: Route;
  readonly children: ReactNode;
}) {
  return (
    <ShellStateProvider>
      <ShellFrame route={route}>{children}</ShellFrame>
    </ShellStateProvider>
  );
}

function ShellFrame({ route, children }: { readonly route: Route; readonly children: ReactNode }) {
  const previousRoute = useRef(route);
  useEffect(() => {
    const previous = previousRoute.current;
    previousRoute.current = route;
    if (shouldClosePreviewOnRouteChange(previous, route)) {
      closePreview();
    }
  }, [route]);
  const columns = useColumns();
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const config = useAtomValue(
    environmentIds[0] === undefined
      ? EMPTY_CONFIG_ATOM
      : serverEnvironment.configValueAtom(environmentIds[0]),
  );
  const threadShells = useAtomValue(environmentThreadShells.navigationThreadShellsAtom);
  useEffect(() => {
    const engineBuild = config?.environment.serverVersion ?? null;
    const engineStamp = config?.environment.clientBuildStamp ?? null;
    const loadedStamp = clientBundleStamp(
      [...document.querySelectorAll("script[src], link[rel=stylesheet][href]")].map(
        (element) => element.getAttribute("src") ?? element.getAttribute("href"),
      ),
    );
    if (!engineBuildIsNewer(engineBuild, APP_VERSION, engineStamp, loadedStamp)) return;
    const key = `skycot:reloaded-for:${engineBuild}:${engineStamp ?? ""}`;
    const reloadWhenIdle = () => {
      try {
        if (sessionStorage.getItem(key) === "1") return true;
      } catch {
        // Reloading is still safe when this browser blocks session storage.
      }
      const hasUnsentText = [...document.querySelectorAll("textarea, input")].some(
        (field) => (field as HTMLTextAreaElement | HTMLInputElement).value.trim().length > 0,
      );
      const hasActiveRun = threadShells.some((thread) => threadRuntimeIsActive(thread.runtime));
      if (!canReloadForEngineUpdate({ hasActiveRun, hasUnsentText })) return false;
      try {
        sessionStorage.setItem(key, "1");
      } catch {
        // This page reloads once; the next build will have a different key.
      }
      window.location.reload();
      return true;
    };
    if (reloadWhenIdle()) return;
    const timer = window.setInterval(() => {
      if (reloadWhenIdle()) window.clearInterval(timer);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [config?.environment.serverVersion, config?.environment.clientBuildStamp, threadShells]);
  const shell = useShellState();
  const childView = useChildView();
  const selectedThreadId: ThreadId | null = route.name === "thread" ? route.threadId : null;
  const selectedEnvironmentId: EnvironmentId | null =
    route.name === "thread" ? route.environmentId : null;

  const conversationRoute =
    route.name === "home" || route.name === "new" || route.name === "thread";
  const showContent = !(columns === 1 && route.name === "home" && !childView);
  // The live preview sits beside the conversation where there is room (the list steps aside
  // so the two share the window), and fills the window on a phone.
  const previewOpen = usePreviewOpen(route.name === "thread" ? route.threadId : null);
  const previewMode = !previewOpen || !showContent ? "hidden" : columns === 1 ? "sheet" : "panel";
  // "Open it" on the fridge or a recap opens that conversation's preview over the screen.
  const previewElsewhere = usePreviewElsewhere(
    route.name === "thread" && previewMode !== "hidden" ? route.threadId : null,
  );
  const showList =
    conversationRoute &&
    !childView &&
    !(columns === 1 && route.name !== "home") &&
    !(columns === 1 && childView && route.name === "home") &&
    previewMode !== "panel";

  // One place owns the window title, derived from the route, so no screen can
  // leave a stale title behind when it unmounts.
  const detail = useTitleDetail(selectedEnvironmentId, selectedThreadId, route);
  useEffect(() => {
    document.title = documentTitle(detail ?? undefined);
  }, [detail]);

  useEffect(() => {
    if (columns === 3 && shell.drawerOpen) shell.setDrawerOpen(false);
  }, [columns, shell]);

  const compose = () => navigate(columns === 1 ? NEW_HREF : HOME_HREF);

  // The Versions rail sits to the right of an open conversation: a full column
  // when there is room and it is open, otherwise a thin strip (or a floating
  // button on a phone) that brings the same timeline up as a sheet.
  const railOpen = useVersionsRailOpen();
  const roomForRail = useRoomForRail();
  const railMode =
    route.name === "thread" && showContent && previewMode !== "panel"
      ? versionsRailMode(columns, railOpen, roomForRail)
      : "hidden";

  return (
    <div
      className="fm-shell"
      data-columns={columns}
      data-inspector={previewMode === "panel" ? "preview" : railMode}
    >
      <TitleBar
        columns={columns}
        detail={detail}
        trailing={
          <>
            <UpdatePill />
            <ProviderPill />
          </>
        }
        showSearch={conversationRoute}
      />
      {/* One grid row for the notices, however many show. */}
      <div className="fm-shell__notices">
        <ConnectionBanner />
        <FamilyHeadsUp />
        <UsageBanner />
        {childView && columns < 3 ? (
          <Button size="sm" variant="quiet" onClick={openChildPicker}>
            Switch who's using SKYCOT
          </Button>
        ) : null}
      </div>
      <NotificationCoordinator />
      <ReadyNotifier />
      <div
        className={`fm-body${showList ? "" : " fm-body--no-list"}${childView && route.name === "thread" ? " fm-body--child-make" : ""}`}
      >
        {columns === 3 || (childView && route.name === "thread") ? (
          <AppSidebar route={route} insideMake={childView && route.name === "thread"} />
        ) : null}
        {showList ? (
          <ConversationList
            columns={columns}
            selectedThreadId={selectedThreadId}
            onCompose={compose}
          />
        ) : null}
        {showContent ? (
          <main className="fm-content" tabIndex={-1}>
            {children}
          </main>
        ) : null}
        {route.name === "thread" && previewMode !== "hidden" ? (
          <PreviewPanel
            environmentId={route.environmentId}
            threadId={route.threadId}
            sheet={previewMode === "sheet"}
          />
        ) : null}
        {previewElsewhere !== null ? (
          <PreviewPanel
            environmentId={previewElsewhere.environmentId}
            threadId={previewElsewhere.threadId}
            sheet
          />
        ) : null}
        {route.name === "thread" && showContent && previewMode !== "panel" ? (
          <VersionsRailSlot
            environmentId={route.environmentId}
            threadId={route.threadId}
            mode={railMode}
            expandable={columns === 3 && roomForRail}
          />
        ) : null}
      </div>
      {columns < 3 && shell.drawerOpen ? (
        <SidebarDrawer route={route} onClose={() => shell.setDrawerOpen(false)} />
      ) : null}
      <UsageSheetHost />
      <CommandPaletteHost />
      <ToastHost />
    </div>
  );
}

/**
 * The sidebar as a modal drawer at two columns or fewer. Portalled next to the
 * sheets so the rest of the app can be made inert while it is open; focus moves
 * to its first item and returns to the "Show sidebar" button on close.
 */
function SidebarDrawer({
  route,
  onClose,
}: {
  readonly route: Route;
  readonly onClose: () => void;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  useModal(drawerRef, { open: true, onClose, initialFocus: "first" });
  return createPortal(
    <>
      <div className="fm-drawer-backdrop" onClick={onClose} aria-hidden />
      <div
        ref={drawerRef}
        className="fm-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Sidebar"
        tabIndex={-1}
      >
        <AppSidebar route={route} onNavigate={onClose} />
      </div>
    </>,
    document.body,
  );
}

function useTitleDetail(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
  route: Route,
): string | null {
  const shellIndex = useAtomValue(
    environmentId === null
      ? EMPTY_THREAD_INDEX_ATOM
      : environmentThreadShells.environmentThreadIndexAtom(environmentId),
  );
  const thread = threadId ? shellIndex.get(threadId) : undefined;
  const ownProject = useAtomValue(
    projectAtomOrEmpty({ environmentId, projectId: thread?.projectId }),
  );
  const projects = useAtomValue(environmentProjects.projectsAtom);
  // A question that became a project shows that project's name.
  const project =
    thread === undefined ? ownProject : projectForConversation(thread, ownProject, projects);
  switch (route.name) {
    case "automations":
      return "Automations";
    case "people":
      return "People";
    case "makes":
      return "Things I made";
    case "fridge":
      return "The fridge";
    case "files":
      return "Files";
    case "stickers":
      return "Sticker book";
    case "certificate":
      return "Certificate";
    case "recap":
      return "Family — Settings";
    case "new":
      return "New conversation";
    case "welcome":
      return "Welcome";
    case "settings":
      return route.section ? `${sectionLabel(route.section)} — Settings` : "Settings";
    case "not-found":
      return "Not found";
    case "thread":
      return project?.title ?? null;
    case "home":
    case "pair":
      return null;
  }
}

/**
 * "Using ChatGPT", from the provider a new conversation would start with, named the way
 * Settings names it, and beside it the ring showing how much of its allowance is left. The
 * Family profile keeps usage out of the child's view (the parent finds it in Settings).
 */
function ProviderPill() {
  const family = useFamily();
  const childView = useChildView();
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const environmentId = environmentIds[0] ?? null;
  const providers = useAtomValue(
    environmentId === null
      ? EMPTY_PROVIDERS_ATOM
      : serverEnvironment.providersValueAtom(environmentId),
  );
  const preference = useDefaultAssistantPreference(environmentId);
  if (childView || environmentId === null || providers === null) return null;
  const provider = providerForSelection(
    providers,
    resolveDefaultModelSelection(providers, null, preference),
  );
  if (provider === null) return null;
  return (
    <span className="fm-usage-status">
      <Pill tone="provider">
        {/* A phone keeps the name and the ring; "Using" stays for screen readers. */}
        <span className="fm-usage-status__using">Using </span>
        {catalogEntryFor(String(provider.driver)).brand}
      </Pill>
      {family.enabled ? null : <UsageIndicator />}
    </span>
  );
}

const EMPTY_THREAD_INDEX_ATOM = Atom.make<ReadonlyMap<ThreadId, OrchestrationV2ThreadShell>>(
  new Map(),
).pipe(Atom.withLabel("nondev-thread-index:empty"));
const EMPTY_PROVIDERS_ATOM = Atom.make<ReadonlyArray<ServerProvider> | null>(null).pipe(
  Atom.withLabel("nondev-providers:empty"),
);

export type { Columns };
