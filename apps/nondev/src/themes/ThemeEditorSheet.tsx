// "Duplicate and edit…": a small editor over the dozen tokens that change a
// look the most, the flavour switches and the crew names. Edits preview live on
// the page behind the sheet and only persist on "Save as new".
import { useEffect, useId, useState } from "react";

import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Sheet } from "../ui/Sheet";
import { TextField } from "../ui/TextField";
import type { Mode } from "./apply";
import {
  COLOR_PATTERN,
  parseTheme,
  type SkycotTheme,
  type ThemeFlavour,
  type TokenName,
} from "./schema";
import { endPreview, importTheme, previewTheme, setActiveTheme } from "./store";

/** The tokens worth a colour well; everything else is inherited from the base theme. */
export const EDITOR_TOKENS: ReadonlyArray<{ readonly name: TokenName; readonly label: string }> = [
  { name: "--fm-bg-window", label: "Window" },
  { name: "--fm-bg-content", label: "Page" },
  { name: "--fm-bg-card", label: "Cards" },
  { name: "--fm-bg-fill", label: "Grouped lists" },
  { name: "--fm-sep", label: "Lines" },
  { name: "--fm-ink", label: "Outlines (pen)" },
  { name: "--fm-label", label: "Text" },
  { name: "--fm-label-2", label: "Quiet text" },
  { name: "--fm-accent", label: "Accent" },
  { name: "--fm-on-accent", label: "Text on accent" },
  { name: "--fm-bubble-me", label: "Your bubbles" },
  { name: "--fm-bubble-crew", label: "Their bubbles" },
  { name: "--fm-green", label: "Good" },
  { name: "--fm-orange", label: "Caution" },
  { name: "--fm-red", label: "Stop" },
  { name: "--fm-marker", label: "Marker pen" },
];

const FLAVOUR_OPTIONS: {
  readonly [K in keyof ThemeFlavour]: ReadonlyArray<{ value: ThemeFlavour[K]; label: string }>;
} = {
  borders: [
    { value: "clean", label: "Clean" },
    { value: "sketch", label: "Hand-drawn" },
  ],
  cards: [
    { value: "flat", label: "Flat" },
    { value: "sticky", label: "Sticky notes" },
  ],
  labels: [
    { value: "system", label: "System" },
    { value: "handwritten", label: "Handwritten" },
    { value: "serif", label: "Serif" },
  ],
  avatars: [
    { value: "initials", label: "Plain" },
    { value: "characters", label: "Characters" },
  ],
  accentShape: [
    { value: "round", label: "Round" },
    { value: "soft", label: "Soft" },
    { value: "square", label: "Square" },
  ],
  motion: [
    { value: "calm", label: "Calm" },
    { value: "playful", label: "Playful" },
  ],
};

const FLAVOUR_LABELS: Record<keyof ThemeFlavour, string> = {
  borders: "Borders",
  cards: "Tip cards",
  labels: "Headings",
  avatars: "Crew faces",
  accentShape: "Button shape",
  motion: "Motion",
};

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return slug.length >= 2 ? slug : "theme";
}

/** A fresh id for a copy: `<slug>-<4 chars>`, so two copies of one base never collide. */
export function newThemeId(name: string): string {
  const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `${slugify(name)}-${suffix}`;
}

interface DraftInput {
  readonly base: SkycotTheme;
  readonly name: string;
  readonly tokens: SkycotTheme["tokens"];
  readonly flavour: ThemeFlavour;
  readonly builder: { readonly name: string; readonly color: string };
  readonly checker: { readonly name: string; readonly color: string };
}

/** The theme object the editor's fields describe, with `id` chosen by the caller. */
export function buildDraft(input: DraftInput, id: string): unknown {
  const { base, name, tokens, flavour, builder, checker } = input;
  const crew =
    builder.name.trim().length > 0 && checker.name.trim().length > 0
      ? {
          builder: { name: builder.name.trim(), color: builder.color },
          checker: { name: checker.name.trim(), color: checker.color },
        }
      : undefined;
  const light = tokens.light;
  return {
    format: base.format,
    id,
    name: name.trim(),
    author: "Me",
    ...(base.description ? { description: base.description } : {}),
    version: "1",
    tokens,
    flavour,
    ...(crew ? { crew } : {}),
    voice: flavour.avatars === "characters" ? "playful" : "neutral",
    preview: {
      bg: light["--fm-bg-window"] ?? base.preview.bg,
      surface: light["--fm-bg-card"] ?? base.preview.surface,
      accent: light["--fm-accent"] ?? base.preview.accent,
      text: light["--fm-label"] ?? base.preview.text,
    },
  };
}

export function ThemeEditorSheet({
  base,
  onClose,
  onSaved,
}: {
  readonly base: SkycotTheme;
  readonly onClose: () => void;
  readonly onSaved: (theme: SkycotTheme) => void;
}) {
  const [name, setName] = useState(`${base.name} copy`);
  const [mode, setMode] = useState<Mode>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  const [tokens, setTokens] = useState(base.tokens);
  const [flavour, setFlavour] = useState<ThemeFlavour>(base.flavour);
  const [builder, setBuilder] = useState({
    name: base.crew?.builder.name ?? "",
    color: base.crew?.builder.color ?? base.preview.accent,
  });
  const [checker, setChecker] = useState({
    name: base.crew?.checker.name ?? "",
    color: base.crew?.checker.color ?? "#34c759",
  });
  const [problems, setProblems] = useState<ReadonlyArray<string> | null>(null);
  const draftInput: DraftInput = { base, name, tokens, flavour, builder, checker };

  // Live preview: every change re-applies the draft; closing restores the real theme.
  useEffect(() => {
    const result = parseTheme(
      buildDraft({ base, name, tokens, flavour, builder, checker }, "preview"),
    );
    if (result.ok) previewTheme(result.theme);
  }, [base, name, tokens, flavour, builder, checker]);
  useEffect(() => () => endPreview(), []);

  const setToken = (tokenName: TokenName, value: string) => {
    setTokens((previous) => ({
      ...previous,
      [mode]: { ...previous[mode], [tokenName]: value },
    }));
  };

  const save = () => {
    setProblems(null);
    const outcome = importTheme(buildDraft(draftInput, newThemeId(name)));
    if (!outcome.ok) {
      setProblems(outcome.problems);
      return;
    }
    endPreview();
    setActiveTheme(outcome.theme.id);
    onSaved(outcome.theme);
  };

  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title="Make your own theme"
      description="Start from the current look, change the colours that matter most, pick a flavour, name your crew. The page behind this sheet shows every change as you make it."
      initialFocus="body"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={name.trim().length === 0}>
            Save as new
          </Button>
        </>
      }
    >
      <div className="fm-theme-editor">
        <div className="fm-theme-editor__row">
          <TextField
            label="Theme name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={60}
          />
          <div className="fm-theme-editor__group">
            <p className="fm-theme-editor__group-title">Editing colours for</p>
            <SegmentedControl<Mode>
              label="Which appearance to edit"
              value={mode}
              onChange={setMode}
              block
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          </div>
        </div>

        <div className="fm-theme-editor__group">
          <p className="fm-theme-editor__group-title">Colours</p>
          <div className="fm-theme-editor__colours">
            {EDITOR_TOKENS.map((token) => (
              <ColourField
                key={token.name}
                label={token.label}
                value={tokens[mode][token.name] ?? ""}
                onChange={(value) => setToken(token.name, value)}
              />
            ))}
          </div>
        </div>

        <div className="fm-theme-editor__group">
          <p className="fm-theme-editor__group-title">Flavour</p>
          <div className="fm-theme-editor__flavours">
            {(Object.keys(FLAVOUR_OPTIONS) as Array<keyof ThemeFlavour>).map((key) => (
              <label key={key} className="fm-theme-editor__flavour">
                {FLAVOUR_LABELS[key]}
                <select
                  className="fm-select"
                  value={flavour[key]}
                  onChange={(event) =>
                    setFlavour((previous) => ({ ...previous, [key]: event.currentTarget.value }))
                  }
                >
                  {FLAVOUR_OPTIONS[key].map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>

        <div className="fm-theme-editor__group">
          <p className="fm-theme-editor__group-title">Your crew (optional)</p>
          <div className="fm-theme-editor__crew">
            <MemberFields role="Builder" member={builder} onChange={setBuilder} />
            <MemberFields role="Checker" member={checker} onChange={setChecker} />
          </div>
          <p className="fm-help">
            Name both and the app says “Sam needs your OK” instead of “Crew”. Leave them blank to
            keep it neutral.
          </p>
        </div>

        {problems ? (
          <Banner tone="warning">
            <b>Not saved yet.</b>
            <ul>
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Banner>
        ) : null}
      </div>
    </Sheet>
  );
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

function ColourField({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const id = useId();
  const isHex = HEX6.test(value);
  return (
    <div className="fm-colour-field">
      <input
        type="color"
        className="fm-colour-field__swatch"
        aria-label={`${label} colour picker`}
        value={isHex ? value : "#888888"}
        onChange={(event) => onChange(event.currentTarget.value)}
        style={isHex ? undefined : { background: value || undefined }}
      />
      <div>
        <label htmlFor={id} className="fm-colour-field__label">
          {label}
        </label>
        <input
          id={id}
          className="fm-colour-field__value"
          value={value}
          placeholder="inherits"
          spellCheck={false}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </div>
    </div>
  );
}

function MemberFields({
  role,
  member,
  onChange,
}: {
  readonly role: string;
  readonly member: { readonly name: string; readonly color: string };
  readonly onChange: (member: { name: string; color: string }) => void;
}) {
  const colorOk = COLOR_PATTERN.test(member.color);
  return (
    <div className="fm-theme-editor__member">
      <span className="fm-theme-editor__member-head">
        <input
          type="color"
          className="fm-colour-field__swatch"
          aria-label={`${role} colour`}
          value={HEX6.test(member.color) ? member.color : "#888888"}
          onChange={(event) => onChange({ ...member, color: event.currentTarget.value })}
        />
        {role}
      </span>
      <TextField
        label={`${role} name`}
        hideLabel
        placeholder={role === "Builder" ? "Sam" : "Mo"}
        value={member.name}
        maxLength={24}
        onChange={(event) => onChange({ ...member, name: event.currentTarget.value })}
      />
      {colorOk ? null : <span className="fm-help">That colour isn't recognised.</span>}
    </div>
  );
}
