// The theme file format. A theme is data, never code: colours, fonts, radii
// and shadows for the `--fm-*` tokens in styles/apple.css, plus a handful of
// "flavour" switches that pick pre-written CSS in styles/flavours.css. Nothing
// here can change what the app does, only how it looks.
//
// This module imports only `effect` so apps/nondev/scripts/validate-theme.ts
// can load it straight from Node without a bundler.
import { Result, Schema, SchemaIssue, SchemaParser } from "effect";

export const THEME_FORMAT = "skycot-theme/1" as const;

/** A theme file may not be larger than this many characters of JSON. */
export const MAX_THEME_BYTES = 64 * 1024;

/**
 * Every token a theme may set. Derived from styles/apple.css; the layout tokens
 * (title bar height, column widths) are deliberately absent because a theme
 * changes looks, not layout.
 */
export const TOKEN_NAMES = [
  // Fonts
  "--fm-font",
  "--fm-font-label",
  "--fm-mono",
  // Backgrounds
  "--fm-bg-window",
  "--fm-bg-toolbar",
  "--fm-bg-content",
  "--fm-bg-card",
  "--fm-bg-fill",
  "--fm-bg-fill-2",
  "--fm-bg-field",
  "--fm-bg-sidebar",
  "--fm-bg-button",
  "--fm-bg-scrim",
  "--fm-sidebar-hover",
  "--fm-paper-dot",
  // Separators
  "--fm-sep",
  "--fm-sep-2",
  "--fm-sidebar-line",
  "--fm-button-line",
  "--fm-ink",
  // Labels
  "--fm-label",
  "--fm-label-2",
  "--fm-label-3",
  "--fm-label-4",
  // Accent and system colours
  "--fm-accent",
  "--fm-accent-soft",
  // Fill behind on-accent text (buttons, badges); falls back to --fm-accent.
  "--fm-accent-fill",
  "--fm-on-accent",
  "--fm-on-status",
  "--fm-green",
  "--fm-green-soft",
  "--fm-green-ink",
  "--fm-orange",
  "--fm-orange-soft",
  "--fm-orange-ink",
  "--fm-red",
  "--fm-red-soft",
  "--fm-red-ink",
  "--fm-provider",
  "--fm-marker",
  "--fm-marker-soft",
  "--fm-marker-ink",
  "--fm-crew-builder",
  "--fm-crew-checker",
  // Bubbles and code
  "--fm-bubble-me",
  "--fm-on-bubble-me",
  "--fm-bubble-crew",
  "--fm-code-bg",
  "--fm-code-bg-me",
  "--fm-knob",
  // Glyph fills (card icons, sheet icons, settings glyphs, avatars)
  "--fm-glyph-blue",
  "--fm-glyph-green",
  "--fm-glyph-orange",
  "--fm-glyph-grey",
  "--fm-glyph-red",
  "--fm-glyph-purple",
  "--fm-glyph-crew",
  "--fm-glyph-person",
  // Radii
  "--fm-radius-sm",
  "--fm-radius",
  "--fm-radius-md",
  "--fm-radius-lg",
  "--fm-radius-xl",
  "--fm-radius-2xl",
  "--fm-radius-bubble",
  // Shadows
  "--fm-shadow-card",
  "--fm-shadow-sheet",
  "--fm-shadow-popover",
  "--fm-shadow-button",
  "--fm-shadow-segment",
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export const TOKEN_NAME_SET: ReadonlySet<string> = new Set<string>(TOKEN_NAMES);

/**
 * A CSS value we are willing to put on the page: colours, lengths, font stacks,
 * gradients and shadows. The character class alone rules out `<`, `;`, `{`,
 * `}` and backslashes; the forbidden list catches the ways CSS can reach out
 * (`url(`, `expression(`, `@import`, `javascript:`) even in otherwise plain text.
 */
export const TOKEN_VALUE_PATTERN = /^[A-Za-z0-9#.,%()/*+\-\s"'_]+$/;
const FORBIDDEN_VALUE_PARTS = [
  "url(",
  "expression(",
  "@import",
  "javascript:",
  "image-set(",
  "var(",
];
export const MAX_TOKEN_VALUE_LENGTH = 200;

export function tokenValueProblem(value: string): string | null {
  if (value.trim().length === 0) return "is empty";
  if (value.length > MAX_TOKEN_VALUE_LENGTH)
    return `is too long (${value.length} characters; the most is ${MAX_TOKEN_VALUE_LENGTH})`;
  const lower = value.toLowerCase().replace(/\s+/g, "");
  for (const part of FORBIDDEN_VALUE_PARTS) {
    if (lower.includes(part)) return `must not contain "${part.replace("(", "(…)")}"`;
  }
  if (!TOKEN_VALUE_PATTERN.test(value))
    return "may only use letters, digits, spaces and # . , % ( ) / - quotes";
  return null;
}

const TokenValue = Schema.String.check(
  Schema.makeFilter((value: string) => tokenValueProblem(value) ?? true, {
    title: "a CSS colour, length, font list, gradient or shadow",
  }),
);

/**
 * A pattern check whose failure reads as a sentence ("must be a colour such as
 * …"), never the regular expression itself, which is what `Schema.isPattern`
 * would print to a theme author.
 */
const shaped = (pattern: RegExp, what: string) =>
  Schema.makeFilter((value: string) => pattern.test(value) || `must be ${what}`, { title: what });

/** Plain colour for previews and the crew: hex, rgb(a), hsl(a) or a CSS colour word. */
export const COLOR_PATTERN =
  /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,%\s/]+\)|hsla?\([0-9.,%\sdeg/]+\)|[a-zA-Z]{3,24})$/;
const Color = Schema.String.check(
  Schema.isMaxLength(64),
  shaped(COLOR_PATTERN, "a colour such as #ff9500 or rgba(0,0,0,0.5)"),
);

const TokenSet = Schema.Record(Schema.Literals(TOKEN_NAMES), Schema.optional(TokenValue));

const ShortText = (max: number) =>
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));

const CrewMember = Schema.Struct({
  name: ShortText(24),
  color: Color,
  emoji: Schema.optionalKey(ShortText(8)),
});

export const Flavour = Schema.Struct({
  borders: Schema.Literals(["clean", "sketch"]),
  cards: Schema.Literals(["flat", "sticky"]),
  labels: Schema.Literals(["system", "handwritten", "serif"]),
  avatars: Schema.Literals(["initials", "characters"]),
  accentShape: Schema.Literals(["round", "soft", "square"]),
  motion: Schema.Literals(["calm", "playful"]),
});

export const SkycotTheme = Schema.Struct({
  format: Schema.Literal(THEME_FORMAT),
  id: Schema.String.check(
    shaped(/^[a-z0-9][a-z0-9-]{1,40}$/, "lowercase letters, digits and dashes, 2 to 41 characters"),
  ),
  name: ShortText(60),
  author: Schema.optionalKey(ShortText(80)),
  description: Schema.optionalKey(ShortText(200)),
  version: Schema.String.check(shaped(/^\d+(\.\d+){0,2}$/, "a version like 1 or 1.2.0")),
  tokens: Schema.Struct({ light: TokenSet, dark: TokenSet }),
  flavour: Flavour,
  crew: Schema.optionalKey(Schema.Struct({ builder: CrewMember, checker: CrewMember })),
  voice: Schema.optionalKey(Schema.Literals(["neutral", "playful"])),
  preview: Schema.Struct({ bg: Color, surface: Color, accent: Color, text: Color }),
});

export type SkycotTheme = typeof SkycotTheme.Type;
export type ThemeFlavour = SkycotTheme["flavour"];
export type ThemeTokens = { readonly [K in TokenName]?: string | undefined };
export type CrewMember = typeof CrewMember.Type;

export type ParseThemeResult =
  | { readonly ok: true; readonly theme: SkycotTheme }
  | { readonly ok: false; readonly problems: ReadonlyArray<string> };

const decode = SchemaParser.decodeUnknownResult(SkycotTheme);
const formatIssue = SchemaIssue.makeFormatterDefault();

/**
 * Validate a theme from JSON text or an already-parsed value. Every failure
 * comes back as a short plain-English sentence a theme author can act on.
 */
export function parseTheme(input: unknown): ParseThemeResult {
  let value: unknown = input;
  if (typeof input === "string") {
    if (input.length > MAX_THEME_BYTES) {
      return {
        ok: false,
        problems: [
          `The file is too big (${Math.round(input.length / 1024)} KB; the most is 64 KB).`,
        ],
      };
    }
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, problems: ["The file isn't valid JSON, so it can't be read."] };
    }
  } else {
    let size = 0;
    try {
      size = JSON.stringify(input)?.length ?? 0;
    } catch {
      return { ok: false, problems: ["The theme can't be turned into JSON."] };
    }
    if (size > MAX_THEME_BYTES) {
      return {
        ok: false,
        problems: [`The theme is too big (${Math.round(size / 1024)} KB; the most is 64 KB).`],
      };
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      problems: ['A theme file is a JSON object with a "format" of "skycot-theme/1".'],
    };
  }
  const result = decode(value, { onExcessProperty: "error", errors: "all" });
  if (Result.isSuccess(result)) return { ok: true, theme: result.success };
  return { ok: false, problems: humanize(formatIssue(result.failure)) };
}

/**
 * The default formatter prints "Expected X\n  at ["a"]["b"]". Fold each pair into
 * one sentence with a readable path, and reword the handful of messages a
 * theme author will actually hit.
 */
export function humanize(formatted: string): ReadonlyArray<string> {
  const lines = formatted.split("\n");
  const problems: string[] = [];
  let pending: string | null = null;
  for (const line of lines) {
    const at = /^\s+at\s+(.*)$/.exec(line);
    if (at && pending !== null) {
      problems.push(`${readablePath(at[1]!)}: ${reword(pending)}`);
      pending = null;
      continue;
    }
    if (pending !== null) problems.push(reword(pending));
    pending = line;
  }
  if (pending !== null) problems.push(reword(pending));
  return problems.length > 0 ? problems : ["The theme didn't pass the checks."];
}

function readablePath(path: string): string {
  const parts = [...path.matchAll(/\["([^"]*)"\]|\[(\d+)\]/g)].map((m) => m[1] ?? m[2] ?? "");
  return parts.length === 0 ? "theme" : parts.join(" › ");
}

function reword(message: string): string {
  const trimmed = message.trim();
  if (/^Expected no excess property$/i.test(trimmed))
    return "this key isn't part of a theme (check the spelling, or remove it)";
  if (/^Missing key$/i.test(trimmed)) return "this is required and is missing";
  if (/^Expected "skycot-theme\/1"/i.test(trimmed))
    return 'the "format" must be exactly "skycot-theme/1"';
  if (/^Expected string, got undefined$/i.test(trimmed) || /^Expected string$/i.test(trimmed))
    return "needs to be text in quotes";
  if (/^Expected a value with a length of at most (\d+)$/i.test(trimmed))
    return trimmed.replace(
      /^Expected a value with a length of at most (\d+)$/i,
      "is too long (the most is $1 characters)",
    );
  if (/^Expected a value with a length of at least 1$/i.test(trimmed)) return "is empty";
  if (trimmed.startsWith('Expected "') && trimmed.includes("|"))
    return `must be one of ${trimmed.slice("Expected ".length).split(" | ").join(", ")}`;
  if (trimmed.startsWith("Expected "))
    return `must be ${trimmed.slice("Expected ".length)}`.replace(
      /^must be object/,
      "must be an object { … }",
    );
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/** The JSON a theme is saved and shared as. */
export function serializeTheme(theme: SkycotTheme): string {
  return `${JSON.stringify(theme, null, 2)}\n`;
}
