import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  OrchestrationV2ThreadShell,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect, type ReactNode } from "react";

import { documentTitle } from "../brand";
import { HOME_HREF, NEW_HREF, navigate, type Route } from "../router";
import { enabledEnvironmentIdsAtom } from "../state/catalog";
import { projectAtomOrEmpty } from "../state/projects";
import {
  providerDisplayName,
  resolveDefaultModelSelection,
  providerForSelection,
} from "../state/providers";
import { serverEnvironment } from "../state/server";
import { environmentThreadShells } from "../state/threads";
import { Pill } from "../ui/Pill";
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

  const detail = useTitleDetail(selectedEnvironmentId, selectedThreadId, route);
  useEffect(() => {
    document.title = documentTitle(detail ?? undefined);
  }, [detail]);

  useEffect(() => {
    if (columns === 3 && shell.drawerOpen) shell.setDrawerOpen(false);
  }, [columns, shell]);

  const compose = () => navigate(columns === 1 ? NEW_HREF : HOME_HREF);

  return (
    <div className="fm-shell" data-columns={columns}>
      <TitleBar columns={columns} detail={detail} trailing={<ProviderPill />} />
      <ConnectionBanner />
      <div className={`fm-body${showList ? "" : " fm-body--no-list"}`}>
        {columns === 3 ? <AppSidebar route={route} /> : null}
        {showList ? (
          <ConversationList
            columns={columns}
            selectedThreadId={selectedThreadId}
            onCompose={compose}
          />
        ) : null}
        {showContent ? <main className="fm-content">{children}</main> : null}
      </div>
      {columns < 3 && shell.drawerOpen ? (
        <SidebarDrawer route={route} onClose={() => shell.setDrawerOpen(false)} />
      ) : null}
    </div>
  );
}

function SidebarDrawer({
  route,
  onClose,
}: {
  readonly route: Route;
  readonly onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="fm-drawer-backdrop" onClick={onClose} aria-hidden />
      <div className="fm-drawer" role="dialog" aria-label="Sidebar">
        <AppSidebar route={route} onNavigate={onClose} />
      </div>
    </>
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
  if (route.name === "automations") return "Automations";
  if (route.name === "people") return "People";
  if (route.name === "new") return "New conversation";
  return project?.title ?? null;
}

/** "Using Claude", from the provider a new conversation would start with. */
function ProviderPill() {
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
  return <Pill tone="provider">Using {providerDisplayName(provider)}</Pill>;
}

const EMPTY_THREAD_INDEX_ATOM = Atom.make<ReadonlyMap<ThreadId, OrchestrationV2ThreadShell>>(
  new Map(),
).pipe(Atom.withLabel("nondev-thread-index:empty"));
const EMPTY_PROVIDERS_ATOM = Atom.make<ReadonlyArray<ServerProvider> | null>(null).pipe(
  Atom.withLabel("nondev-providers:empty"),
);

export type { Columns };
