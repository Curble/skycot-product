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
