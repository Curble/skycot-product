/**
 * What the Lock Screen says: the Live Activity and the Home Screen widget, worked out from
 * what the app already knows. Content-free on purpose: a name and what is happening, never a
 * project, a conversation's title or anything a child typed (WHO-IS-WHO, "Notifications say
 * only 'Sam needs a grown-up'").
 */
export type ActivityPhase = "building" | "needs-you" | "needs-grown-up" | "quiet";

export interface FamilyActivity {
  readonly headline: string;
  readonly detail: string;
  readonly phase: ActivityPhase;
  readonly count: number;
  readonly updatedAt: string;
  /** Where a tap goes: always the app's front door; the app opens the right screen. */
  readonly deepLink: string;
}

export function childActivity(
  input: { readonly building: number; readonly waiting: number; readonly builder: string },
  now: Date = new Date(),
): FamilyActivity | null {
  if (input.waiting > 0) {
    return {
      headline: `${input.builder} needs your OK`,
      detail: "Open SKYCOT to answer.",
      phase: "needs-you",
      count: input.waiting,
      updatedAt: now.toISOString(),
      deepLink: "/",
    };
  }
  if (input.building > 0) {
    return {
      headline: `${input.builder} is building…`,
      detail: "SKYCOT tells you when it's ready.",
      phase: "building",
      count: input.building,
      updatedAt: now.toISOString(),
      deepLink: "/",
    };
  }
  return null;
}

export function grownUpActivity(
  input: { readonly waitingChildNames: ReadonlyArray<string> },
  now: Date = new Date(),
): FamilyActivity | null {
  const names = input.waitingChildNames;
  if (names.length === 0) return null;
  const first = names[0]!;
  const others = new Set(names).size - 1;
  return {
    headline:
      others > 0 ? `${first} and ${others} more need a grown-up` : `${first} needs a grown-up`,
    detail: "Open SKYCOT to say yes once, or no.",
    phase: "needs-grown-up",
    count: names.length,
    updatedAt: now.toISOString(),
    deepLink: "/",
  };
}

export const QUIET: Omit<FamilyActivity, "updatedAt"> = {
  headline: "All quiet",
  detail: "Nothing needs you right now.",
  phase: "quiet",
  count: 0,
  deepLink: "/",
};
