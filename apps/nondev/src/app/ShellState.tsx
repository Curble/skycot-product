import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { ConversationFilter } from "../state/conversations";

export interface ShellState {
  readonly filter: ConversationFilter;
  /** `${environmentId}:${projectId}` when a project is selected in the sidebar. */
  readonly projectKey: string | null;
  readonly search: string;
  /** The sidebar drawer at two columns or fewer. */
  readonly drawerOpen: boolean;
  setFilter(filter: ConversationFilter): void;
  setProjectKey(key: string | null): void;
  setSearch(search: string): void;
  setDrawerOpen(open: boolean): void;
}

const ShellStateContext = createContext<ShellState | null>(null);

export function ShellStateProvider({ children }: { readonly children: ReactNode }) {
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const value = useMemo<ShellState>(
    () => ({
      filter,
      projectKey,
      search,
      drawerOpen,
      setFilter: (next) => {
        setFilter(next);
        setProjectKey(null);
      },
      setProjectKey: (next) => {
        setProjectKey(next);
        setFilter("all");
      },
      setSearch,
      setDrawerOpen,
    }),
    [filter, projectKey, search, drawerOpen],
  );
  return <ShellStateContext.Provider value={value}>{children}</ShellStateContext.Provider>;
}

export function useShellState(): ShellState {
  const value = useContext(ShellStateContext);
  if (value === null) throw new Error("useShellState must be used inside ShellStateProvider");
  return value;
}
