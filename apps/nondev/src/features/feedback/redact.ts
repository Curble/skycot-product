// Takes a piece of engine log text and removes anything that could point at a person, a
// folder, an account or a child, before the grown-up even sees it. The grown-up still reads the
// result in full before anything is sent.

const KEPT_HOSTS = ["skycot.com"];

function isKeptHost(host: string): boolean {
  const lower = host.toLowerCase().replace(/:\d+$/, "");
  return KEPT_HOSTS.some((kept) => lower === kept || lower.endsWith(`.${kept}`));
}

// A skycot.com link survives, so it is parked behind a marker while the other rules run.
const MARK = "\u0000";

export function redactForFeedback(text: string): string {
  const kept: string[] = [];
  let out = text.replace(/\bhttps?:\/\/([^\s/"'<>`)]+)[^\s"'<>`)]*/gi, (match, host: string) => {
    if (!isKeptHost(host.replace(/^[^@]*@/, ""))) return "[link]";
    kept.push(match.replace(/\d/g, (digit) => `${MARK}d${digit}${MARK}`));
    return `${MARK}k${kept.length - 1}${MARK}`;
  });
  // Folders: /Users/<name>/…, other home and temp locations, and ~/…
  out = out.replace(
    /(?:\/(?:Users|home|Volumes|private|var|tmp|opt|Library)\/[^\s"'`:;,)\]}]*|~\/[^\s"'`:;,)\]}]*)/g,
    "[path]",
  );
  out = out.replace(/[A-Za-z]:\\Users\\[^\s"'`]*/g, "[path]");
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, "[email]");
  // Long mixed letter-and-number strings (ids, tokens, codes).
  out = out.replace(
    /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g,
    "[code]",
  );
  // Any run of four or more digits (4-8 digit codes, and longer ones such as phone numbers).
  out = out.replace(/(?<!\d)\d{4,}(?!\d)/g, "[number]");
  return out.replace(new RegExp(`${MARK}k(\\d+)${MARK}`, "g"), (_m, index: string) =>
    kept[Number(index)]!.replace(new RegExp(`${MARK}d(\\d)${MARK}`, "g"), "$1"),
  );
}

/** Whole-word, any-case removal of known names (a child's name must never travel). */
export function removeNames(text: string, names: ReadonlyArray<string>): string {
  let out = text;
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length === 0) continue;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"),
      "[name]",
    );
  }
  return out;
}
