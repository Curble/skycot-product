import { describe, expect, it } from "vite-plus/test";

import classic from "./library/classic.theme.json";
import nightOps from "./library/night-ops.theme.json";
import paper from "./library/paper.theme.json";
import workshop from "./library/workshop.theme.json";
import {
  MAX_THEME_BYTES,
  TOKEN_NAMES,
  parseTheme,
  serializeTheme,
  tokenValueProblem,
} from "./schema";

const LIBRARY = { classic, workshop, paper, "night-ops": nightOps } as const;

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: "skycot-theme/1",
    id: "my-theme",
    name: "My theme",
    version: "1.0.0",
    tokens: { light: { "--fm-accent": "#ff9500" }, dark: {} },
    flavour: {
      borders: "clean",
      cards: "flat",
      labels: "system",
      avatars: "initials",
      accentShape: "soft",
      motion: "calm",
    },
    preview: { bg: "#ffffff", surface: "#ffffff", accent: "#ff9500", text: "#000000" },
    ...overrides,
  };
}

function problemsOf(input: unknown): ReadonlyArray<string> {
  const result = parseTheme(input);
  if (result.ok) throw new Error("expected the theme to be rejected");
  return result.problems;
}

describe("built-in library", () => {
  it.each(Object.entries(LIBRARY))(
    "%s is a valid theme with every token in both modes",
    (id, json) => {
      const result = parseTheme(json);
      expect(result.ok, result.ok ? "" : result.problems.join("\n")).toBe(true);
      if (!result.ok) return;
      expect(result.theme.id).toBe(id);
      for (const name of TOKEN_NAMES) {
        expect(result.theme.tokens.light[name], `${id} light ${name}`).toBeTypeOf("string");
        expect(result.theme.tokens.dark[name], `${id} dark ${name}`).toBeTypeOf("string");
      }
    },
  );

  it("workshop names its crew and asks for the playful flavours", () => {
    const result = parseTheme(workshop);
    expect(result.ok && result.theme.crew?.builder.name).toBe("Sam");
    expect(result.ok && result.theme.crew?.checker.name).toBe("Mo");
    expect(result.ok && result.theme.flavour.borders).toBe("sketch");
    expect(result.ok && result.theme.flavour.motion).toBe("playful");
  });

  it("round-trips through serializeTheme", () => {
    const result = parseTheme(classic);
    if (!result.ok) throw new Error("classic should parse");
    const again = parseTheme(serializeTheme(result.theme));
    expect(again.ok && again.theme).toEqual(result.theme);
  });
});

describe("parseTheme accepts", () => {
  it("a minimal theme from JSON text, with partial token sets", () => {
    const result = parseTheme(JSON.stringify(valid()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.theme.tokens.light["--fm-accent"]).toBe("#ff9500");
  });

  it("gradients, shadows and quoted font stacks as token values", () => {
    const result = parseTheme(
      valid({
        tokens: {
          light: {
            "--fm-glyph-blue": "linear-gradient(180deg, #5ab0ff, #0a84ff)",
            "--fm-shadow-card": "0 0 0 0.5px rgba(0, 0, 0, 0.1), 0 2px 10px rgba(0, 0, 0, 0.06)",
            "--fm-font-label": '"Chalkboard SE", "Comic Neue", cursive',
          },
          dark: {},
        },
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("parseTheme rejects", () => {
  it("text that is not JSON", () => {
    expect(problemsOf("{ not json")).toEqual(["The file isn't valid JSON, so it can't be read."]);
  });

  it("the wrong format tag", () => {
    expect(problemsOf(valid({ format: "skycot-theme/2" })).join("\n")).toMatch(/format/);
  });

  it("unknown top-level keys and unknown token names, naming each", () => {
    const problems = problemsOf(
      valid({
        extra: 1,
        tokens: { light: { "--fm-nope": "#fff", "--not-ours": "red" }, dark: {} },
      }),
    );
    expect(problems.some((p) => p.startsWith("extra:"))).toBe(true);
    expect(problems.some((p) => p.includes("--fm-nope"))).toBe(true);
    expect(problems.some((p) => p.includes("--not-ours"))).toBe(true);
  });

  it("values that could reach out of CSS", () => {
    for (const bad of [
      "url(javascript:alert(1))",
      "url(https://evil.example/x.png)",
      "expression(alert(1))",
      "red; } body { display: none",
      "@import 'x'",
      "<svg>",
      "image-set(url(x))",
      "var(--anything)",
      "a\\62",
    ]) {
      const problems = problemsOf(valid({ tokens: { light: { "--fm-accent": bad }, dark: {} } }));
      expect(problems.length, bad).toBeGreaterThan(0);
      expect(problems.join(" ")).toContain("--fm-accent");
    }
  });

  it("over-long values and over-size files", () => {
    expect(
      problemsOf(
        valid({ tokens: { light: { "--fm-accent": "#".padEnd(201, "f") }, dark: {} } }),
      ).join(" "),
    ).toMatch(/too long/);
    const big = JSON.stringify(valid({ description: "x".repeat(10) })).padEnd(
      MAX_THEME_BYTES + 1,
      " ",
    );
    expect(problemsOf(big)[0]).toMatch(/too big/);
    const bigObject = valid({ tokens: { light: {}, dark: {} }, name: "ok" });
    (bigObject as Record<string, unknown>).padding = "x".repeat(MAX_THEME_BYTES);
    expect(problemsOf(bigObject)[0]).toMatch(/too big/);
  });

  it("bad ids, missing keys and wrong enum values with readable paths", () => {
    const problems = problemsOf(
      valid({ id: "Has Spaces", flavour: { ...(valid().flavour as object), borders: "wiggly" } }),
    );
    expect(problems.some((p) => p.startsWith("id:"))).toBe(true);
    expect(problems.some((p) => p.startsWith("flavour › borders:"))).toBe(true);
    const missing = { ...valid() };
    delete (missing as Record<string, unknown>).preview;
    expect(problemsOf(missing).some((p) => p.startsWith("preview:") && /missing/.test(p))).toBe(
      true,
    );
  });

  it("crew colours that are not colours", () => {
    const problems = problemsOf(
      valid({
        crew: {
          builder: { name: "Sam", color: "url(x)" },
          checker: { name: "Mo", color: "#3fa66f" },
        },
      }),
    );
    expect(problems.some((p) => p.startsWith("crew › builder › color:"))).toBe(true);
  });

  it("arrays and primitives", () => {
    expect(problemsOf([]).length).toBe(1);
    expect(problemsOf(42).length).toBe(1);
  });
});

describe("tokenValueProblem", () => {
  it("accepts ordinary CSS values", () => {
    for (const ok of [
      "#fff",
      "rgba(0, 0, 0, 0.5)",
      "12px",
      "255px 15px 225px 15px / 15px 225px 15px 255px",
      "transparent",
      "none",
    ]) {
      expect(tokenValueProblem(ok), ok).toBeNull();
    }
  });
  it("names the forbidden part", () => {
    expect(tokenValueProblem("URL( x )")).toContain("url(");
    expect(tokenValueProblem("")).toBe("is empty");
  });
});
