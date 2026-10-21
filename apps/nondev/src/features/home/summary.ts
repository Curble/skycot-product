/** The one-line status under the Home greeting. */
export function summarySentence(
  working: number,
  waiting: number,
  ready: number,
  total: number,
  connected = true,
): string {
  // Until the engine has answered, an empty list means "not loaded", not "nothing".
  if (total === 0 && !connected) {
    return "Waiting for your Mac. Your conversations appear once it's reachable.";
  }
  if (total === 0) return "Nothing is on the go yet. Start a conversation below.";
  const parts: string[] = [];
  if (working > 0) parts.push(`${count(working, "job is", "jobs are")} running`);
  if (waiting > 0) parts.push(`${count(waiting, "job is", "jobs are")} waiting on you`);
  if (ready > 0) parts.push(`${count(ready, "job is", "jobs are")} ready to look at`);
  if (parts.length === 0) return "All quiet. Nothing is running or waiting on you.";
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
