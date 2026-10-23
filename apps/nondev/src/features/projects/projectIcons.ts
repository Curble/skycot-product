// A project's name and icon, pure part. Both are the engine's own fields (`title` and
// `projectIcon` on the project), so a new name or icon shows on every device, in Advanced
// mode and in the grown-ups' recap, with nothing kept in the browser. SKYCOT offers two
// kinds the engine stores: a letter on one of the six colours a child's picture uses, or a
// friendly emoji. SKYCOT's own poses stay for people (a child's picture), so a project
// never looks like a person in the sidebar.
import type { ProjectIconColor, ProjectIconOverride } from "@t3tools/contracts";

import { AVATAR_COLORS, COLOR_NAMES, type AvatarColor } from "../family/children";
import { cleanTitle, type TitleCheck } from "../tidy/tidy";

/** The six picture colours, as the engine names them. */
export const ENGINE_COLOR: Readonly<Record<AvatarColor, ProjectIconColor>> = {
  sky: "sky",
  sun: "amber",
  leaf: "green",
  berry: "pink",
  grape: "violet",
  coral: "orange",
};

/**
 * Which of the six a colour from anywhere (Advanced mode offers eighteen) is drawn in, so
 * an icon chosen there still looks at home here. Grey stays grey.
 */
const NEAREST: Readonly<Record<ProjectIconColor, AvatarColor | null>> = {
  gray: null,
  red: "coral",
  orange: "coral",
  amber: "sun",
  yellow: "sun",
  lime: "leaf",
  green: "leaf",
  emerald: "leaf",
  teal: "leaf",
  cyan: "sky",
  sky: "sky",
  blue: "sky",
  indigo: "grape",
  violet: "grape",
  purple: "grape",
  fuchsia: "berry",
  pink: "berry",
  rose: "berry",
};

export function pictureColorOf(color: ProjectIconColor): AvatarColor | null {
  return NEAREST[color] ?? null;
}

/** Friendly symbols, each with the name a screen reader says. */
export const PROJECT_EMOJI: ReadonlyArray<{ readonly emoji: string; readonly name: string }> = [
  { emoji: "🚀", name: "Rocket" },
  { emoji: "🎮", name: "Game controller" },
  { emoji: "🦖", name: "Dinosaur" },
  { emoji: "🐱", name: "Cat" },
  { emoji: "🐶", name: "Dog" },
  { emoji: "🦄", name: "Unicorn" },
  { emoji: "🐠", name: "Fish" },
  { emoji: "🌈", name: "Rainbow" },
  { emoji: "⭐", name: "Star" },
  { emoji: "🎨", name: "Paint palette" },
  { emoji: "🎵", name: "Music" },
  { emoji: "📚", name: "Books" },
  { emoji: "🧪", name: "Science" },
  { emoji: "🏰", name: "Castle" },
  { emoji: "⚽", name: "Football" },
  { emoji: "🍕", name: "Pizza" },
  { emoji: "🌍", name: "World" },
  { emoji: "🤖", name: "Robot" },
];

/**
 * The letter a project's name starts with (its first letter or digit), as the engine
 * accepts it; null for a name with none ("🚀 !!").
 */
export function monogramLetter(title: string): string | null {
  const match = /[\p{L}\p{N}]/u.exec(title);
  return match ? match[0].toLocaleUpperCase() : null;
}

/** A choice in the grid: no icon (the name's initials on grey), a letter, or an emoji. */
export type IconChoice =
  | { readonly kind: "none" }
  | { readonly kind: "letter"; readonly color: AvatarColor }
  | { readonly kind: "emoji"; readonly emoji: string };

/** Every choice the grid shows for a name, in order. Letters only when the name has one. */
export function iconChoices(title: string): ReadonlyArray<IconChoice> {
  return [
    { kind: "none" },
    ...(monogramLetter(title) === null
      ? []
      : AVATAR_COLORS.map((color): IconChoice => ({ kind: "letter", color }))),
    ...PROJECT_EMOJI.map(({ emoji }): IconChoice => ({ kind: "emoji", emoji })),
  ];
}

/** The engine's icon for a choice and a name. */
export function iconFor(choice: IconChoice, title: string): ProjectIconOverride | null {
  if (choice.kind === "none") return null;
  if (choice.kind === "emoji") return { kind: "emoji", emoji: choice.emoji };
  const letter = monogramLetter(title);
  return letter === null
    ? null
    : { kind: "monogram", text: letter, color: ENGINE_COLOR[choice.color] };
}

/** Which choice an icon the engine has is, for the grid's tick (null: none of these). */
export function choiceOf(icon: ProjectIconOverride | null | undefined): IconChoice | null {
  if (icon === null || icon === undefined) return { kind: "none" };
  if (icon.kind === "emoji") {
    return PROJECT_EMOJI.some((entry) => entry.emoji === icon.emoji)
      ? { kind: "emoji", emoji: icon.emoji }
      : null;
  }
  if (icon.kind === "monogram") {
    const color = (Object.keys(ENGINE_COLOR) as AvatarColor[]).find(
      (key) => ENGINE_COLOR[key] === icon.color,
    );
    return color === undefined ? null : { kind: "letter", color };
  }
  return null;
}

export function sameChoice(a: IconChoice | null, b: IconChoice | null): boolean {
  if (a === null || b === null) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "letter" && b.kind === "letter") return a.color === b.color;
  if (a.kind === "emoji" && b.kind === "emoji") return a.emoji === b.emoji;
  return true;
}

export function choiceLabel(choice: IconChoice, title: string): string {
  if (choice.kind === "none") return "No icon: the name's first letters";
  if (choice.kind === "emoji") {
    return PROJECT_EMOJI.find((entry) => entry.emoji === choice.emoji)?.name ?? choice.emoji;
  }
  return `${monogramLetter(title) ?? "Letter"} on ${COLOR_NAMES[choice.color].toLowerCase()}`;
}

export function sameIcon(
  a: ProjectIconOverride | null | undefined,
  b: ProjectIconOverride | null | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * A letter icon follows the name, like a contact's monogram: renaming "Games" to "Pets"
 * turns a G into a P in the same colour. A letter chosen in Advanced mode that is not the
 * name's first letter is left alone, and so is every other kind of icon.
 */
export function iconAfterRename(
  icon: ProjectIconOverride | null | undefined,
  oldTitle: string,
  newTitle: string,
): ProjectIconOverride | null {
  const current = icon ?? null;
  if (current === null || current.kind !== "monogram") return current;
  if (current.text !== monogramLetter(oldTitle)) return current;
  const letter = monogramLetter(newTitle);
  return letter === null ? null : { ...current, text: letter };
}

/** The icon a project will have with this name and this choice (the sheet's preview). */
export function plannedIcon(
  current: {
    readonly title: string;
    readonly projectIcon?: ProjectIconOverride | null | undefined;
  },
  title: string,
  choice: IconChoice | null,
): ProjectIconOverride | null {
  return choice === null || sameChoice(choice, choiceOf(current.projectIcon))
    ? iconAfterRename(current.projectIcon, current.title, title)
    : iconFor(choice, title);
}

export interface ProjectChange {
  readonly title?: string;
  readonly projectIcon?: ProjectIconOverride | null;
}

/**
 * What to send for a name typed and a choice picked, or why not. Only what changed is sent,
 * so the engine sees a plain rename or a plain icon change (both open to a child).
 */
export function projectChange(input: {
  readonly current: {
    readonly title: string;
    readonly projectIcon?: ProjectIconOverride | null | undefined;
  };
  readonly typed: string;
  /** Null keeps the icon it has (one the grid does not offer, from Advanced mode). */
  readonly choice: IconChoice | null;
}): { readonly ok: true; readonly change: ProjectChange } | Extract<TitleCheck, { ok: false }> {
  const checked = cleanTitle(input.typed);
  if (!checked.ok) return checked;
  const titleChanged = checked.title !== input.current.title;
  const icon = plannedIcon(input.current, checked.title, input.choice);
  return {
    ok: true,
    change: {
      ...(titleChanged ? { title: checked.title } : {}),
      ...(sameIcon(icon, input.current.projectIcon) ? {} : { projectIcon: icon }),
    },
  };
}
