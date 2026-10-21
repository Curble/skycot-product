// Who the assistant is called. Themes may name a crew (Workshop: Sam builds,
// Mo checks); everything else falls back to the neutral "Crew" from brand.ts
// so no screen ever shows an empty name.
import { CREW_NAME } from "../brand";
import type { SkycotTheme } from "./schema";
import { useActiveTheme } from "./store";

export interface CrewMember {
  readonly name: string;
  /** A CSS colour usable in a style attribute. */
  readonly color: string;
  readonly emoji: string | null;
}

export interface Crew {
  /** True when the theme named its characters; copy can then say "Sam needs your OK". */
  readonly named: boolean;
  readonly builder: CrewMember;
  readonly checker: CrewMember;
  readonly characters: boolean;
  readonly playful: boolean;
}

export const NEUTRAL_CREW: Crew = {
  named: false,
  builder: { name: CREW_NAME, color: "var(--fm-crew-builder)", emoji: null },
  checker: { name: CREW_NAME, color: "var(--fm-crew-checker)", emoji: null },
  characters: false,
  playful: false,
};

export function crewFor(theme: SkycotTheme | null): Crew {
  if (theme === null) return NEUTRAL_CREW;
  const characters = theme.flavour.avatars === "characters";
  const playful = theme.voice === "playful";
  if (!theme.crew) return { ...NEUTRAL_CREW, characters, playful };
  return {
    named: true,
    builder: {
      name: theme.crew.builder.name,
      color: theme.crew.builder.color,
      emoji: theme.crew.builder.emoji ?? null,
    },
    checker: {
      name: theme.crew.checker.name,
      color: theme.crew.checker.color,
      emoji: theme.crew.checker.emoji ?? null,
    },
    characters,
    playful,
  };
}

/** "Mo's" / "Chris'" for headings like "Mo's quick check". */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

export function useCrew(): Crew {
  return crewFor(useActiveTheme());
}
