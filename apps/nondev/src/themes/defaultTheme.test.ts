import { describe, expect, it } from "vite-plus/test";

// index.html is the first-paint script; read as text, the way the About pane reads LICENSE.
import indexHtml from "../../index.html?raw";
import { paintColors } from "./apply";
import { DEFAULT_THEME_ID, resolveActiveThemeId, settleBrowserDefault } from "./defaultTheme";
import { BUILT_IN_THEMES, CLASSIC_THEME_ID } from "./library";

describe("default look", () => {
  it("is Workshop for anyone new", () => {
    expect(DEFAULT_THEME_ID).toBe("workshop");
    const fresh = settleBrowserDefault({ settled: null, chosen: null, ranBefore: false });
    expect(fresh).toBe("workshop");
    expect(resolveActiveThemeId(null, fresh)).toBe("workshop");
  });

  it("respects a look someone picked, Classic included", () => {
    for (const chosen of ["classic", "paper", "night-ops", "my-own-theme", "workshop"]) {
      const settled = settleBrowserDefault({ settled: null, chosen, ranBefore: true });
      expect(resolveActiveThemeId(chosen, settled)).toBe(chosen);
    }
  });

  it("keeps Classic for a browser that was already looking at it before Workshop became the default", () => {
    // Back then picking Classic stored nothing, so nothing stored on a used browser means Classic.
    const legacy = settleBrowserDefault({ settled: null, chosen: null, ranBefore: true });
    expect(legacy).toBe(CLASSIC_THEME_ID);
    expect(resolveActiveThemeId(null, legacy)).toBe("classic");
    // A browser that already used the app with a custom look gets Workshop if that look is removed.
    expect(settleBrowserDefault({ settled: null, chosen: "paper", ranBefore: true })).toBe(
      "workshop",
    );
  });

  it("settles once: a new browser that finishes onboarding without picking stays on Workshop", () => {
    const first = settleBrowserDefault({ settled: null, chosen: null, ranBefore: false });
    // Next visit: it has run before and still stored no choice, but the first visit settled it.
    expect(settleBrowserDefault({ settled: first, chosen: null, ranBefore: true })).toBe(
      "workshop",
    );
    expect(settleBrowserDefault({ settled: "classic", chosen: null, ranBefore: true })).toBe(
      "classic",
    );
  });

  it("ignores anything unexpected in the settled key", () => {
    expect(settleBrowserDefault({ settled: "neon", chosen: null, ranBefore: false })).toBe(
      "workshop",
    );
  });

  it("lists Workshop first, and the first paint of a new browser uses Workshop's colours", () => {
    expect(BUILT_IN_THEMES[0]?.id).toBe("workshop");
    const workshop = BUILT_IN_THEMES.find((theme) => theme.id === DEFAULT_THEME_ID)!;
    const colours = paintColors(workshop);
    const html = indexHtml;
    expect(html).toContain(
      `const fallback = isDark ? "${colours.dark.window}" : "${colours.light.window}";`,
    );
    expect(html).toContain(`<meta name="theme-color" content="${colours.light.toolbar}" />`);
  });
});
