/** The one-line status under the Home greeting. */
import { rowsForChild } from "../family-limits/order";

const DAY_MS = 24 * 60 * 60_000;

/** Rows represented by Home's counts and list. An unpressed plan stops being urgent after a day. */
export function homeRows<
  R extends {
    readonly shell: { readonly id: string };
    readonly at: string;
    readonly status: { readonly kind: string; readonly headline: string };
  },
>(
  rows: ReadonlyArray<R>,
  childView: boolean,
  childId: string | null,
  owners: Readonly<Record<string, string>>,
  now = Date.now(),
): ReadonlyArray<R> {
  const active = rows.filter((row) =>
    ["working", "preparing", "waiting", "ready", "failed"].includes(row.status.kind),
  );
  const mine = childView ? rowsForChild(active, (row) => row.shell.id, owners, childId) : active;
  return mine.filter(
    (row) =>
      !(
        row.status.kind === "waiting" &&
        /made a plan/i.test(row.status.headline) &&
        now - Date.parse(row.at) > DAY_MS
      ),
  );
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
      `${count(needsGrownUp, childView ? "thing needs" : "job needs", childView ? "things need" : "jobs need")} a grown-up`,
    );
  if (ready > 0) parts.push(`${count(ready, one, many)} ready to look at`);
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
      index === 0 ? part : part.replace(/^(\S+) jobs? (is|are)/, "$1 $2").replace(/^One\b/, "one"),
    )
    .join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function count(n: number, one: string, many: string): string {
  const word = n === 1 ? "One" : String(n);
  return `${word} ${n === 1 ? one : many}`;
}
