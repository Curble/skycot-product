// The command palette (Cmd+K): which entries it offers, how typing narrows them, and the
// keys. Navigation only: nothing here changes a setting or runs anything a grown-up approves.
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";

import { HOME_HREF, NEW_HREF, SETTINGS_HREF, filesHref, threadHref } from "../../router";
import { grownUpControlsShown } from "../compose/depthChoice";

export type PaletteIcon = "new" | "project" | "conversation" | "files" | "settings";

export interface PaletteItem {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon: PaletteIcon;
  readonly run:
    | { readonly kind: "go"; readonly href: string }
    | { readonly kind: "project"; readonly projectKey: string };
}

export interface PaletteSources {
  readonly columns: 1 | 2 | 3;
  readonly projects: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly title: string;
    readonly projectKey: string;
    readonly isScratch?: boolean;
  }>;
  readonly conversations: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly title: string;
    readonly projectTitle?: string | null;
  }>;
}

export const RECENT_LIMIT = 8;

/** The palette and its shortcut exist only where the thinking-depth control does. */
export function paletteAvailable(who: {
  readonly childView: boolean;
  readonly familyOn: boolean;
}): boolean {
  return grownUpControlsShown(who);
}

/** Cmd+K on a Mac, Ctrl+K anywhere else. */
export function isPaletteShortcut(event: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}): boolean {
  if (event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey) return false;
  return isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;
}

export function paletteItems(sources: PaletteSources): ReadonlyArray<PaletteItem> {
  const items: PaletteItem[] = [
    {
      id: "new",
      label: "New conversation",
      icon: "new",
      run: { kind: "go", href: sources.columns === 1 ? NEW_HREF : HOME_HREF },
    },
  ];
  for (const project of sources.projects) {
    items.push({
      id: `project:${project.projectKey}`,
      label: project.title,
      hint: "Project",
      icon: "project",
      run: { kind: "project", projectKey: project.projectKey },
    });
  }
  for (const conversation of sources.conversations.slice(0, RECENT_LIMIT)) {
    items.push({
      id: `thread:${conversation.id}`,
      label: conversation.title,
      ...(conversation.projectTitle ? { hint: conversation.projectTitle } : {}),
      icon: "conversation",
      run: { kind: "go", href: threadHref(conversation.environmentId, conversation.id) },
    });
  }
  for (const project of sources.projects) {
    if (project.isScratch === true) continue;
    items.push({
      id: `files:${project.projectKey}`,
      label: `Files in ${project.title}`,
      hint: "Files",
      icon: "files",
      run: { kind: "go", href: filesHref(project.environmentId, project.id) },
    });
  }
  items.push({
    id: "settings",
    label: "Settings",
    icon: "settings",
    run: { kind: "go", href: SETTINGS_HREF },
  });
  return items;
}

/** Plain, case-insensitive "contains" on the label or hint; an empty search keeps everything. */
export function filterItems(
  items: ReadonlyArray<PaletteItem>,
  query: string,
): ReadonlyArray<PaletteItem> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return items;
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(needle) || (item.hint ?? "").toLowerCase().includes(needle),
  );
}

/** The highlighted row after Up (-1) or Down (1), wrapping at both ends. */
export function moveSelection(current: number, count: number, direction: 1 | -1): number {
  if (count === 0) return 0;
  return (current + direction + count) % count;
}
