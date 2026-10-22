// The built-in themes. Each JSON file is validated by schema.test.ts and again
// here at load, so a typo in the library fails loudly in development instead of
// silently falling back to Classic.
import classicJson from "./library/classic.theme.json";
import nightOpsJson from "./library/night-ops.theme.json";
import paperJson from "./library/paper.theme.json";
import workshopJson from "./library/workshop.theme.json";
import { parseTheme, type SkycotTheme } from "./schema";

function load(json: unknown, id: string): SkycotTheme {
  const result = parseTheme(json);
  if (!result.ok)
    throw new Error(`Built-in theme "${id}" is invalid: ${result.problems.join("; ")}`);
  return result.theme;
}

export const CLASSIC_THEME_ID = "classic";

// Workshop first: it is the default look (defaultTheme.ts); Classic is the calm alternative.
export const BUILT_IN_THEMES: ReadonlyArray<SkycotTheme> = [
  load(workshopJson, "workshop"),
  load(classicJson, "classic"),
  load(paperJson, "paper"),
  load(nightOpsJson, "night-ops"),
];

export const CLASSIC_THEME: SkycotTheme = BUILT_IN_THEMES.find(
  (theme) => theme.id === CLASSIC_THEME_ID,
)!;

export function isBuiltInThemeId(id: string): boolean {
  return BUILT_IN_THEMES.some((theme) => theme.id === id);
}
