// The family fridge, pure part: every conversation that made a page, as one magnet each.
// What is "made" is read from the checkpoints (the newest kept change that touched a page);
// the only thing the fridge stores is which magnets are pinned. Taking one down never deletes
// a file: the page stays in its project and the conversation stays in the list.
// nondev-seam: skycot-iphone-q50-fridge-title
import { pageOf, type RecapFile } from "../family-recap/recap.ts";

export interface FridgeThread {
  readonly threadId: string;
  readonly projectId: string;
  readonly title: string;
  readonly cwd: string | null;
  readonly deleted: boolean;
  readonly checkpoints: ReadonlyArray<{
    readonly runId: string | null;
    readonly capturedAt: number;
    readonly files: ReadonlyArray<RecapFile>;
  }>;
  readonly runs: ReadonlyArray<{ readonly id: string; readonly status: string }>;
}

export interface FridgeItem {
  readonly threadId: string;
  readonly projectId: string;
  readonly title: string;
  /** The child who started it; null outside the Family profile or for older work. */
  readonly childId: string | null;
  readonly madeAt: number;
  readonly page: string;
  readonly contentHash?: string;
  readonly thumbnailSvg?: string;
  // nondev-seam: skycot-fridge-card-store
  /** Names the saved card file (`/fridge/card?hash=`); changes whenever the page does. */
  readonly cardHash?: string;
  /** True when a picture of the real page is saved (`/fridge/picture?hash=<cardHash>`). */
  readonly hasPicture?: boolean;
  readonly cwd: string;
  readonly pinnedAt: number | null;
}

function xmlText(text: string): string {
  return text.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

/** A tiny inert picture for the fridge; page markup is only read as text, never opened. */
// nondev-seam: skycot-q51-fridge-svg
/** Relative luminance (0 dark, 1 light) of a `#rgb` or `#rrggbb` colour; null if it is not one. */
export function colorLuminance(color: string): number | null {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/iu.exec(color)?.[1];
  if (hex === undefined) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = Number.parseInt(full.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * The words' colour for a card's mat: dark ink on a light mat, light ink on a dark one. A mid
 * tone suits neither, so it also gets a small plate in the opposite shade behind the words.
 */
export function cardInk(mat: string): { readonly ink: string; readonly plate: string | null } {
  const luminance = colorLuminance(mat) ?? 0.2;
  const ink = luminance > 0.4 ? "#1d1d1f" : "#ffffff";
  const midTone = luminance > 0.18 && luminance < 0.5;
  return { ink, plate: midTone ? (ink === "#ffffff" ? "#000000" : "#ffffff") : null };
}

export function fridgeSvgThumbnail(html: string, fallbackTitle: string): string {
  const title = fridgePageTitle(html) ?? fallbackTitle;
  const heading = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/iu)?.[1] ?? "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const colors = html.match(/#[\da-f]{3}(?:[\da-f]{3})?\b/giu) ?? [];
  const colorCounts = new Map<string, number>();
  for (const color of colors) colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
  const background = [...colorCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "#5b7cfa";
  const kind = /quiz|trivia|question/iu.test(`${title} ${html}`)
    ? "?"
    : /birthday|card/iu.test(title)
      ? "♡"
      : /game|play|bounce/iu.test(`${title} ${html}`)
        ? "✦"
        : "▤";
  const { ink, plate } = cardInk(background);
  const plateRect =
    plate === null
      ? ""
      : `<rect x="8" y="112" width="304" height="58" rx="12" fill="${plate}" fill-opacity=".38"/>`;
  const sparkle = ink === "#ffffff" ? "#ffffff" : "#000000";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" rx="20" fill="${background}"/><circle cx="160" cy="65" r="38" fill="${sparkle}" fill-opacity=".18"/><text x="160" y="79" text-anchor="middle" font-size="44" fill="${ink}">${kind}</text>${plateRect}<text x="18" y="137" font-family="system-ui,sans-serif" font-size="18" font-weight="700" fill="${ink}">${xmlText(title.slice(0, 30))}</text><text x="18" y="161" font-family="system-ui,sans-serif" font-size="12" fill="${ink}">${xmlText(heading.slice(0, 42))}</text></svg>`;
}

/** A page's own name wins over the conversation's first request. */
export function fridgePageTitle(html: string): string | null {
  const text = (
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu)?.[1] ??
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/iu)?.[1] ??
    ""
  )
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;|&#34;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length > 0 ? text.slice(0, 80) : null;
}

/** One magnet per conversation that made a page, newest first. */
export function fridgeItems(
  threads: ReadonlyArray<FridgeThread>,
  owners: Readonly<Record<string, string>>,
  pins: Readonly<Record<string, number>>,
): Array<FridgeItem> {
  const items: Array<FridgeItem> = [];
  for (const thread of threads) {
    if (thread.deleted || thread.cwd === null) continue;
    const undone = new Set(
      thread.runs.filter((run) => run.status === "rolled_back").map((run) => run.id),
    );
    const latest = [...thread.checkpoints]
      .filter(
        (checkpoint) =>
          (checkpoint.runId === null || !undone.has(checkpoint.runId)) &&
          pageOf(checkpoint.files) !== null,
      )
      .sort((a, b) => b.capturedAt - a.capturedAt)[0];
    if (latest === undefined) continue;
    items.push({
      threadId: thread.threadId,
      projectId: thread.projectId,
      title: thread.title,
      childId: owners[thread.threadId] ?? null,
      madeAt: latest.capturedAt,
      page: pageOf(latest.files)!,
      cwd: thread.cwd,
      pinnedAt: pins[thread.threadId] ?? null,
    });
  }
  return items.sort((a, b) => b.madeAt - a.madeAt);
}
