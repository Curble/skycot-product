import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";

import { Button } from "~/components/ui/button";

import { enabledEnvironmentIdsAtom, environmentCatalog } from "../state/catalog";
import { environmentProjects } from "../state/projects";
import { environmentShell } from "../state/shell";
import { environmentThreadShells } from "../state/threads";
import { threadHref } from "../router";

export function HomeRoute() {
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);

  return (
    <main className="mx-auto flex h-full w-full max-w-3xl flex-col gap-6 overflow-y-auto px-6 py-8 text-foreground">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold">T3 Code Simple</h1>
        <span className="text-xs text-muted-foreground">
          {catalog.isReady ? `${environmentIds.length} environment(s)` : "Loading environments..."}
        </span>
      </header>
      {catalog.isReady && environmentIds.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No environment is registered yet. The server that served this page should appear here
          within a few seconds.
        </p>
      ) : null}
      {environmentIds.map((environmentId) => (
        <EnvironmentSection key={environmentId} environmentId={environmentId} />
      ))}
    </main>
  );
}

function EnvironmentSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const entry = useAtomValue(environmentCatalog.catalogValueAtom).entries.get(environmentId);
  const status = useAtomValue(environmentShell.statusAtom(environmentId));
  const projects = useAtomValue(environmentProjects.environmentProjectsAtom(environmentId));
  const threads = useAtomValue(environmentThreadShells.environmentThreadsAtom(environmentId));

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card/60 p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-base font-medium">{entry?.target.label ?? environmentId}</h2>
        <span className="text-xs text-muted-foreground">shell: {status}</span>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">Projects</h3>
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {projects.map((project) => (
              <li key={project.id} className="flex items-baseline justify-between gap-3">
                <span>{project.title}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {project.workspaceRoot}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">Threads</h3>
        {threads.length === 0 ? (
          <p className="text-sm text-muted-foreground">No threads yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {threads.map((thread) => (
              <li key={thread.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{thread.title || "Untitled thread"}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{thread.status}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    render={<a href={threadHref(environmentId, thread.id)} />}
                  >
                    Open
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
