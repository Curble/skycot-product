import { describe, expect, it } from "vite-plus/test";

import {
  applyThemeToRoot,
  clearThemeFromRoot,
  paintColors,
  tokensFor,
  type ThemeRoot,
} from "./apply";
import { BUILT_IN_THEMES, CLASSIC_THEME } from "./library";
import { parseTheme, TOKEN_NAMES, type SkycotTheme } from "./schema";

function fakeRoot() {
  const props = new Map<string, string>();
  const attrs = new Map<string, string>();
  const root: ThemeRoot = {
    style: {
      setProperty: (name, value) => void props.set(name, value),
      removeProperty: (name) => {
        const old = props.get(name) ?? "";
        props.delete(name);
        return old;
      },
    },
    setAttribute: (name, value) => void attrs.set(name, value),
    removeAttribute: (name) => void attrs.delete(name),
  };
  return { root, props, attrs };
}

const workshop = BUILT_IN_THEMES.find((theme) => theme.id === "workshop")!;

describe("tokensFor", () => {
  it("returns the mode's values in the allow-list order and skips names the theme leaves out", () => {
    const result = parseTheme({
      ...CLASSIC_THEME,
      id: "partial",
      tokens: {
        light: { "--fm-accent": "#111111", "--fm-radius": "3px" },
        dark: { "--fm-accent": "#222222" },
      },
    });
    if (!result.ok) throw new Error(result.problems.join("\n"));
    const light = tokensFor(result.theme, "light");
    expect([...light.entries()]).toEqual([
      ["--fm-accent", "#111111"],
      ["--fm-radius", "3px"],
    ]);
    expect(tokensFor(result.theme, "dark").get("--fm-accent")).toBe("#222222");
  });
});

describe("applyThemeToRoot", () => {
  it("sets every token of the mode, data-theme and the six flavour attributes", () => {
    const { root, props, attrs } = fakeRoot();
    applyThemeToRoot(workshop, "light", root);
    expect(props.get("--fm-bg-window")).toBe("#fff6e6");
    expect(props.get("--fm-font-label")).toContain("Chalkboard SE");
    expect(props.size).toBe(TOKEN_NAMES.length);
    expect(attrs.get("data-theme")).toBe("workshop");
    expect(attrs.get("data-flavour-borders")).toBe("sketch");
    expect(attrs.get("data-flavour-cards")).toBe("sticky");
    expect(attrs.get("data-flavour-labels")).toBe("handwritten");
    expect(attrs.get("data-flavour-avatars")).toBe("characters");
    expect(attrs.get("data-flavour-accent-shape")).toBe("round");
    expect(attrs.get("data-flavour-motion")).toBe("playful");
  });

  it("switching mode swaps the values, and the crew colours ride along", () => {
    const { root, props } = fakeRoot();
    applyThemeToRoot(workshop, "dark", root);
    expect(props.get("--fm-bg-window")).toBe("#241e1a");
    expect(props.get("--fm-crew-builder")).toBe("#f26b4e");
    expect(props.get("--fm-crew-checker")).toBe("#3fa66f");
  });

  it("removes tokens a sparser theme does not set, so the stylesheet default shows through", () => {
    const { root, props, attrs } = fakeRoot();
    applyThemeToRoot(workshop, "light", root);
    const sparse: SkycotTheme = {
      ...CLASSIC_THEME,
      id: "sparse",
      tokens: { light: { "--fm-accent": "#123456" }, dark: {} },
    };
    applyThemeToRoot(sparse, "light", root);
    expect(props.get("--fm-accent")).toBe("#123456");
    expect(props.has("--fm-bg-window")).toBe(false);
    expect(props.size).toBe(1);
    expect(attrs.get("data-theme")).toBe("sparse");
    expect(attrs.get("data-flavour-borders")).toBe("clean");
  });

  it("clearThemeFromRoot leaves nothing behind", () => {
    const { root, props, attrs } = fakeRoot();
    applyThemeToRoot(workshop, "light", root);
    clearThemeFromRoot(root);
    expect(props.size).toBe(0);
    expect(attrs.size).toBe(0);
  });
});

describe("paintColors", () => {
  it("reads the window and toolbar colours per mode, falling back to Classic", () => {
    expect(paintColors(workshop)).toEqual({
      light: { window: "#fff6e6", toolbar: "#fff9ef" },
      dark: { window: "#241e1a", toolbar: "#2c2521" },
    });
    const bare: SkycotTheme = { ...CLASSIC_THEME, id: "bare", tokens: { light: {}, dark: {} } };
    expect(paintColors(bare).dark).toEqual({ window: "#1e1e1e", toolbar: "#262628" });
  });
});
