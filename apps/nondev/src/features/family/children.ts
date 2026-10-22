// The children of a Family profile, as the engine reports them (SkycotFamily.ts, file
// version 2): a name, a picture, a look, larger text, voice settings and limits each. Pure:
// parsing, defaults and the words Settings uses. The engine checks every field again.
export const AVATAR_POSES = [
  "hello",
  "yay",
  "thinking",
  "oops",
  "ask-a-grown-up",
  "night-night",
] as const;
export type AvatarPose = (typeof AVATAR_POSES)[number];

export const AVATAR_COLORS = ["sky", "sun", "leaf", "berry", "grape", "coral"] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

export type ChildAvatar =
  | { readonly kind: "mascot"; readonly pose: AvatarPose }
  | { readonly kind: "initial"; readonly color: AvatarColor };

export interface ChildLimits {
  readonly bedtime: { readonly start: string; readonly end: string } | null;
  readonly dailyMinutes: number | null;
  readonly dailyTurns: number | null;
  readonly keepAllowancePercent: number | null;
}

export interface ChildVoice {
  readonly typing: boolean;
  readonly readAloud: boolean;
}

export interface FamilyChild {
  readonly id: string;
  readonly name: string | null;
  readonly avatar: ChildAvatar;
  readonly look: string;
  readonly largerText: boolean;
  readonly voice: ChildVoice;
  readonly limits: ChildLimits;
}

export const NO_LIMITS: ChildLimits = {
  bedtime: null,
  dailyMinutes: null,
  dailyTurns: null,
  keepAllowancePercent: null,
};

/** Voice typing goes to the browser's speech service: off until a parent says yes. */
export const DEFAULT_VOICE: ChildVoice = { typing: false, readAloud: true };

export const MAX_CHILDREN = 8;

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const numberOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function parseAvatar(value: unknown): ChildAvatar {
  const input = record(value);
  if (
    input["kind"] === "mascot" &&
    (AVATAR_POSES as ReadonlyArray<unknown>).includes(input["pose"])
  ) {
    return { kind: "mascot", pose: input["pose"] as AvatarPose };
  }
  return {
    kind: "initial",
    color: (AVATAR_COLORS as ReadonlyArray<unknown>).includes(input["color"])
      ? (input["color"] as AvatarColor)
      : "sky",
  };
}

function parseLimits(value: unknown): ChildLimits {
  const input = record(value);
  const bedtime = record(input["bedtime"]);
  return {
    bedtime:
      typeof bedtime["start"] === "string" && typeof bedtime["end"] === "string"
        ? { start: bedtime["start"], end: bedtime["end"] }
        : null,
    dailyMinutes: numberOrNull(input["dailyMinutes"]),
    dailyTurns: numberOrNull(input["dailyTurns"]),
    keepAllowancePercent: numberOrNull(input["keepAllowancePercent"]),
  };
}

export function parseChild(value: unknown): FamilyChild | null {
  const input = record(value);
  if (typeof input["id"] !== "string") return null;
  const voice = record(input["voice"]);
  return {
    id: input["id"],
    name: typeof input["name"] === "string" && input["name"].trim() ? input["name"] : null,
    avatar: parseAvatar(input["avatar"]),
    look: typeof input["look"] === "string" ? input["look"] : "workshop",
    largerText: input["largerText"] !== false,
    voice: {
      typing: voice["typing"] === true,
      readAloud: voice["readAloud"] !== false,
    },
    limits: parseLimits(input["limits"]),
  };
}

export function parseChildren(value: unknown): ReadonlyArray<FamilyChild> {
  return Array.isArray(value)
    ? value.flatMap((entry: unknown) => {
        const child = parseChild(entry);
        return child === null ? [] : [child];
      })
    : [];
}

/** "Ava", or "Child 2" for a child without a name (numbered by their place in the list). */
export function childLabel(child: Pick<FamilyChild, "name">, index: number): string {
  return child.name ?? (index === 0 ? "Your child" : `Child ${index + 1}`);
}

/** The letter on a letter picture: the name's first letter, or a friendly star. */
export function avatarLetter(child: Pick<FamilyChild, "name">): string {
  const letter = child.name?.trim().charAt(0);
  return letter ? letter.toLocaleUpperCase() : "★";
}

export const POSE_NAMES: Readonly<Record<AvatarPose, string>> = {
  hello: "Waving",
  yay: "Cheering",
  thinking: "Thinking",
  oops: "Oops",
  "ask-a-grown-up": "Asking",
  "night-night": "Sleepy",
};

export const COLOR_NAMES: Readonly<Record<AvatarColor, string>> = {
  sky: "Sky blue",
  sun: "Sunshine",
  leaf: "Leaf green",
  berry: "Berry",
  grape: "Grape",
  coral: "Coral",
};

/** "Ava, Leo and Mia". */
export function namesList(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
