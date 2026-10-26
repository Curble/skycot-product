/** The one-line status under the Home greeting. */
import { rowsForChild } from "../family-limits/order";

/** Rows represented by Home's counts and list. */
export function homeRows<
  R extends {
    readonly shell: { readonly id: string };
    readonly status: { readonly kind: string; readonly headline: string };
  },
>(
  rows: ReadonlyArray<R>,
  childView: boolean,
  childId: string | null,
  owners: Readonly<Record<string, string>>,
): ReadonlyArray<R> {
  const active = rows.filter((row) =>
    ["working", "preparing", "waiting", "plan", "ready", "failed"].includes(row.status.kind),
  );
  const mine = childView ? rowsForChild(active, (row) => row.shell.id, owners, childId) : active;
  return mine;
}

export function summarySentence(
  working: number,
  waiting: number,
  ready: number,
  total: number,
  connected = true,
  childView = false,
  needsGrownUp = 0,
  failed = 0,
  plansReady = 0,
): string {
  // Until the engine has answered, an empty list means "not loaded", not "nothing".
  if (total === 0 && !connected) {
    return childView
      ? "Waiting for your Mac. Your things appear once it's reachable."
      : "Waiting for your Mac. Your conversations appear once it's reachable.";
  }
  if (total === 0)
    return childView
      ? "Nothing is on the go yet. Make something below."
      : "Nothing is on the go yet. Start a conversation below.";
  const parts: string[] = [];
  const one = childView ? "thing is" : "job is";
  const many = childView ? "things are" : "jobs are";
  if (working > 0)
    parts.push(`${count(working, one, many)} ${childView ? "being made" : "running"}`);
  if (waiting > 0) parts.push(`${count(waiting, one, many)} waiting on you`);
  if (needsGrownUp > 0)
    parts.push(
      needsGrownUp === 1
        ? "A grown-up needs to say yes"
        : `${needsGrownUp} things need a grown-up to say yes`,
    );
  if (ready > 0) parts.push(`${count(ready, one, many)} ready to look at`);
  if (plansReady > 0)
    parts.push(plansReady === 1 ? "Your plan is ready" : `${plansReady} plans are ready`);
  if (failed > 0)
    parts.push(
      count(
        failed,
        childView ? "thing didn't work" : "job didn't work",
        childView ? "things didn't work" : "jobs didn't work",
      ),
    );
  if (parts.length === 0)
    return childView
      ? "All quiet. Sam isn't making anything right now."
      : "All quiet. Nothing is running or waiting on you.";
  // "One job is running, one is waiting on you": the noun once, then pronouns.
  const sentence = parts
    .map((part, index) =>
      index === 0
        ? part
        : part
            .replace(/^(\S+) jobs? (is|are)/, "$1 $2")
            .replace(/^One\b/, "one")
            .replace(/^A\b/, "a"),
    )
    .join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function count(n: number, one: string, many: string): string {
  const word = n === 1 ? "One" : String(n);
  return `${word} ${n === 1 ? one : many}`;
}
