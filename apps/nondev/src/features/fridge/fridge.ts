// The family fridge, pure part of the client: the engine's magnets (`GET
// /api/skycot/family/fridge`) grouped by child, pinned ones first, and the three the Home tile
// shows. Nothing here deletes anything: "Take it down" only unpins.

export interface FridgeItem {
  readonly threadId: string;
  readonly projectId: string;
  readonly title: string;
  readonly childId: string | null;
  readonly madeAt: number;
  readonly page: string;
  readonly contentHash?: string;
  readonly thumbnailSvg?: string;
  /** Names the engine's picture card for this page; a new page version has a new hash. */
  readonly cardHash?: string;
  /** True when the engine holds a captured picture of the real page for `cardHash`. */
  readonly hasPicture?: boolean;
  readonly cwd: string;
  readonly pinnedAt: number | null;
}

/**
 * Whether this viewer may pin or take down a magnet. The engine's /fridge/pin rule: a child (own
 * device or the shared Mac) changes only their own magnets; a grown-up (viewer null) any. The
 * screen hides the button otherwise, so a sibling never presses one that silently does nothing.
 */
export function mayPinMagnet(
  item: Pick<FridgeItem, "childId">,
  viewer: { readonly childId: string | null } | null,
): boolean {
  return viewer === null || (viewer.childId !== null && item.childId === viewer.childId);
}

export function childFridgeTitle(
  item: Pick<FridgeItem, "title" | "madeAt">,
  childName: string | null,
): string {
  const title = item.title.trim();
  if (!/^(?:page|a birthday card page for|birthday card for .{0,3})$/iu.test(title)) return title;
  const date = new Date(item.madeAt).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
  return `${childName ? `${childName}'s` : "Your"} page · ${date}`;
}

export function fridgeIcon(
  title: string,
  page: string,
): "gamecontroller.fill" | "gift.fill" | "questionmark.square.fill" | "doc.richtext.fill" {
  const value = `${title} ${page}`;
  if (/quiz|trivia|question/iu.test(value)) return "questionmark.square.fill";
  if (/card|birthday/iu.test(value)) return "gift.fill";
  if (/game|play|bounce/iu.test(value)) return "gamecontroller.fill";
  return "doc.richtext.fill";
}

export function fridgeKindLabel(title: string, page: string): string {
  switch (fridgeIcon(title, page)) {
    case "questionmark.square.fill":
      return "Quiz";
    case "gift.fill":
      return "Card";
    case "gamecontroller.fill":
      return "Game";
    default:
      return "Page";
  }
}

export function parseFridge(body: unknown): ReadonlyArray<FridgeItem> | null {
  if (typeof body !== "object" || body === null) return null;
  const items = (body as Record<string, unknown>)["items"];
  if (!Array.isArray(items)) return null;
  return items.filter(
    (item): item is FridgeItem =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as FridgeItem).threadId === "string" &&
      typeof (item as FridgeItem).page === "string" &&
      typeof (item as FridgeItem).cwd === "string" &&
      typeof (item as FridgeItem).madeAt === "number" &&
      ((item as FridgeItem).contentHash === undefined ||
        typeof (item as FridgeItem).contentHash === "string") &&
      ((item as FridgeItem).thumbnailSvg === undefined ||
        typeof (item as FridgeItem).thumbnailSvg === "string") &&
      ((item as FridgeItem).cardHash === undefined ||
        typeof (item as FridgeItem).cardHash === "string") &&
      ((item as FridgeItem).hasPicture === undefined ||
        typeof (item as FridgeItem).hasPicture === "boolean"),
  );
}

/** Pinned magnets first (newest pin first), then everything else, newest first. */
export function fridgeOrder(items: ReadonlyArray<FridgeItem>): Array<FridgeItem> {
  return [...items].sort((a, b) => {
    if ((a.pinnedAt === null) !== (b.pinnedAt === null)) return a.pinnedAt === null ? 1 : -1;
    if (a.pinnedAt !== null && b.pinnedAt !== null && a.pinnedAt !== b.pinnedAt) {
      return b.pinnedAt - a.pinnedAt;
    }
    return b.madeAt - a.madeAt;
  });
}

export interface FridgeShelf {
  /** null: work from before the Family profile, or SKYCOT without one. */
  readonly childId: string | null;
  readonly items: ReadonlyArray<FridgeItem>;
}

/**
 * One shelf per child in the profile's order (a child with nothing yet still gets a shelf),
 * then anything nobody is known to have made. `only` keeps one child's shelf.
 */
export function fridgeShelves(
  items: ReadonlyArray<FridgeItem>,
  childIds: ReadonlyArray<string>,
  only: string | null = null,
): Array<FridgeShelf> {
  const known = new Set(childIds);
  const shelves: Array<FridgeShelf> = childIds.map((childId) => ({
    childId,
    items: fridgeOrder(items.filter((item) => item.childId === childId)),
  }));
  const rest = items.filter((item) => item.childId === null || !known.has(item.childId));
  if (rest.length > 0) shelves.push({ childId: null, items: fridgeOrder(rest) });
  return only === null ? shelves : shelves.filter((shelf) => shelf.childId === only);
}

/** The Home tile: the three newest pinned magnets, topped up with the newest made. */
export function homeMagnets(items: ReadonlyArray<FridgeItem>, count = 3): Array<FridgeItem> {
  return fridgeOrder(items).slice(0, count);
}

/** "Made today", "Made yesterday", "Made 14 Oct". */
export function madeLabel(madeAt: number, now: number): string {
  const day = (at: number) => new Date(at).toDateString();
  if (day(madeAt) === day(now)) return "Made today";
  if (day(madeAt) === day(now - 24 * 60 * 60_000)) return "Made yesterday";
  return `Made ${new Date(madeAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
}
