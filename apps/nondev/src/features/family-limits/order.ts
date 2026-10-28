// The Home list with siblings: the conversations the child using SKYCOT started come first,
// then everyone else's (a sibling's, and ones from before anyone was chosen). Pure.
export interface ChildOrder<R> {
  readonly mine: ReadonlyArray<R>;
  readonly others: ReadonlyArray<R>;
}

export function childFirst<R>(
  rows: ReadonlyArray<R>,
  threadIdOf: (row: R) => string,
  owners: Readonly<Record<string, string>>,
  childId: string | null,
): ChildOrder<R> | null {
  if (childId === null) return null;
  const mine: R[] = [];
  const others: R[] = [];
  for (const row of rows) (owners[threadIdOf(row)] === childId ? mine : others).push(row);
  return { mine, others };
}

/** Work a child profile may list: only conversations the engine recorded for this child. */
export function rowsForChild<R>(
  rows: ReadonlyArray<R>,
  threadIdOf: (row: R) => string,
  owners: Readonly<Record<string, string>>,
  childId: string | null,
): ReadonlyArray<R> {
  return childId === null ? [] : rows.filter((row) => owners[threadIdOf(row)] === childId);
}

/** Only projects the engine records for this child may appear in their picker. */
export function projectsForChild<P>(
  projects: ReadonlyArray<P>,
  projectIdOf: (project: P) => string,
  owners: Readonly<Record<string, string>>,
  childId: string | null,
  ownProjectIds: ReadonlySet<string>,
): ReadonlyArray<P> {
  if (childId === null) return [];
  return projects.filter((project) => {
    const id = projectIdOf(project);
    const owner = owners[id];
    return owner === childId || ownProjectIds.has(id);
  });
}

/**
 * Projects a child may START new work in: ones the engine records for them, or that nobody owns.
 * Never a sibling's, even where the child has a conversation of their own (seeing is not starting).
 */
export function projectsChildMayStartIn<P>(
  projects: ReadonlyArray<P>,
  projectIdOf: (project: P) => string,
  owners: Readonly<Record<string, string>>,
  childId: string | null,
): ReadonlyArray<P> {
  if (childId === null) return [];
  return projects.filter((project) => {
    const owner = owners[projectIdOf(project)];
    return owner === undefined || owner === childId;
  });
}

/**
 * The projects a child's message box may aim at. The engine's own list (`startIn`) wins, since
 * only it knows every owner; an older engine without it falls back to the owner map we hold.
 */
export function startableProjects<P>(
  projects: ReadonlyArray<P>,
  projectIdOf: (project: P) => string,
  today: {
    readonly projects: Readonly<Record<string, string>>;
    readonly startIn?: ReadonlyArray<string> | undefined;
  },
  childId: string | null,
): ReadonlyArray<P> {
  if (childId === null) return [];
  const { startIn } = today;
  if (Array.isArray(startIn)) {
    const allowed = new Set<string>(startIn);
    return projects.filter((project) => allowed.has(projectIdOf(project)));
  }
  return projectsChildMayStartIn(projects, projectIdOf, today.projects, childId);
}

/**
 * Conversations the engine has not said who started, among `rows`. A brand-new one is the
 * usual case: the engine records its child as it starts, but this device's copy of who
 * started what was read earlier, so it asks again rather than filing it under someone else.
 */
export function unknownThreadIds<R>(
  rows: ReadonlyArray<R>,
  threadIdOf: (row: R) => string,
  owners: Readonly<Record<string, string>>,
): ReadonlyArray<string> {
  return rows.map(threadIdOf).filter((threadId) => owners[threadId] === undefined);
}

/** Who started what, with `threadId` as `childId`'s; the engine's first answer stands. */
export function withStarter(
  owners: Readonly<Record<string, string>>,
  threadId: string,
  childId: string,
): Readonly<Record<string, string>> {
  return owners[threadId] === undefined ? { ...owners, [threadId]: childId } : owners;
}
