import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  OrchestrationV2ThreadShell,
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
import { NotificationCoordinator } from "../features/notifications/NotificationCoordinator";
import { catalogEntryFor } from "../features/settings/providerCatalog";
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
import { projectAtomOrEmpty } from "../state/projects";
import { resolveDefaultModelSelection, providerForSelection } from "../state/providers";
import { serverEnvironment } from "../state/server";
import { environmentThreadShells } from "../state/threads";
import { Pill } from "../ui/Pill";
import { useModal } from "../ui/useModal";
import { ConnectionBanner } from "./ConnectionBanner";
import { ConversationList } from "./ConversationList";
import { AppSidebar } from "./Sidebar";
import { ShellStateProvider, useShellState } from "./ShellState";
import { TitleBar } from "./TitleBar";
import { useColumns, type Columns } from "./useColumns";

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
  const columns = useColumns();
  const shell = useShellState();
  const selectedThreadId: ThreadId | null = route.name === "thread" ? route.threadId : null;
  const selectedEnvironmentId: EnvironmentId | null =
    route.name === "thread" ? route.environmentId : null;

  const conversationRoute =
    route.name === "home" || route.name === "new" || route.name === "thread";
  const showList = conversationRoute && !(columns === 1 && route.name !== "home");
  const showContent = !(columns === 1 && route.name === "home");

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
    route.name === "thread" && showContent
      ? versionsRailMode(columns, railOpen, roomForRail)
      : "hidden";

  return (
    <div className="fm-shell" data-columns={columns} data-inspector={railMode}>
      <TitleBar
        columns={columns}
        detail={detail}
        trailing={<ProviderPill />}
        showSearch={conversationRoute}
      />
      {/* One grid row for the notices, however many show. */}
      <div className="fm-shell__notices">
        <ConnectionBanner />
        <FamilyHeadsUp />
        <UsageBanner />
      </div>
      <NotificationCoordinator />
      <div className={`fm-body${showList ? "" : " fm-body--no-list"}`}>
        {columns === 3 ? <AppSidebar route={route} /> : null}
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
        {route.name === "thread" && showContent ? (
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
  const project = useAtomValue(projectAtomOrEmpty({ environmentId, projectId: thread?.projectId }));
  switch (route.name) {
    case "automations":
      return "Automations";
    case "people":
      return "People";
    case "fridge":
      return "The fridge";
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
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const environmentId = environmentIds[0] ?? null;
  const providers = useAtomValue(
    environmentId === null
      ? EMPTY_PROVIDERS_ATOM
      : serverEnvironment.providersValueAtom(environmentId),
  );
  if (environmentId === null || providers === null) return null;
  const provider = providerForSelection(providers, resolveDefaultModelSelection(providers, null));
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
