// The theme picker: live preview cards drawn from each theme's `preview`
// colours and flavour, the active one ticked. Hovering or focusing a card tries
// it on for a moment; clicking keeps it. Settings adds import / export / share /
// duplicate under the grid; onboarding shows the compact grid alone.
import { Check, Copy, Download, PencilLine, Trash2, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";

import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { isBuiltInThemeId } from "./library";
import { serializeTheme, type SkycotTheme } from "./schema";
import {
  endPreview,
  importTheme,
  previewTheme,
  removeCustomTheme,
  setActiveTheme,
  useActiveTheme,
  useThemes,
} from "./store";
import { ThemeEditorSheet } from "./ThemeEditorSheet";

/** How long a hover/focus preview stays before the real theme comes back. */
export const PREVIEW_MS = 1500;

export function ThemeGallery({
  compact = false,
  showActions = true,
  label = "Theme",
}: {
  readonly compact?: boolean;
  readonly showActions?: boolean;
  readonly label?: string;
}) {
  const themes = useThemes();
  const active = useActiveTheme();
  const builtIn = themes.filter((theme) => isBuiltInThemeId(theme.id));
  const custom = themes.filter((theme) => !isBuiltInThemeId(theme.id));
  const [problems, setProblems] = useState<ReadonlyArray<string> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<SkycotTheme | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewTimer = useRef<number | null>(null);

  // Leaving the gallery always puts the chosen theme back.
  useEffect(
    () => () => {
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
      endPreview();
    },
    [],
  );

  const startPreview = (theme: SkycotTheme) => {
    if (theme.id === active.id) return;
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewTheme(theme);
    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = null;
      endPreview();
    }, PREVIEW_MS);
  };
  const stopPreview = () => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewTimer.current = null;
    endPreview();
  };
  const choose = (theme: SkycotTheme) => {
    stopPreview();
    setActiveTheme(theme.id);
    setNotice(null);
  };

  const onImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setProblems(null);
    setNotice(null);
    const text = await file.text();
    const outcome = importTheme(text);
    if (!outcome.ok) {
      setProblems(outcome.problems);
      return;
    }
    setActiveTheme(outcome.theme.id);
    setNotice(
      outcome.replaced
        ? `Updated “${outcome.theme.name}” and switched to it.`
        : `Added “${outcome.theme.name}” to My themes and switched to it.`,
    );
  };

  const exportActive = () => {
    const blob = new Blob([serializeTheme(active)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${active.id}.skycot-theme.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(serializeTheme(active));
      setNotice(
        `Copied “${active.name}” as text. Paste it to a friend; they import it from this screen.`,
      );
    } catch {
      setProblems(["Couldn't reach the clipboard. Use “Export this theme” instead."]);
    }
  };

  const grid = (list: ReadonlyArray<SkycotTheme>) => (
    <div
      role="radiogroup"
      aria-label={label}
      className={`fm-themes${compact ? " fm-themes--compact" : ""}`}
    >
      {list.map((theme) => (
        <ThemePreviewCard
          key={theme.id}
          theme={theme}
          checked={theme.id === active.id}
          onChoose={() => choose(theme)}
          onPreviewStart={() => startPreview(theme)}
          onPreviewEnd={stopPreview}
        />
      ))}
    </div>
  );

  return (
    <>
      {grid(builtIn)}
      {custom.length > 0 ? (
        <>
          <div className="fm-themes__section">My themes</div>
          {grid(custom)}
        </>
      ) : null}
      {showActions ? (
        <>
          <div className="fm-themes__actions">
            <Button size="sm" icon={Upload} onClick={() => fileInput.current?.click()}>
              Import a theme…
            </Button>
            <Button size="sm" icon={Download} onClick={exportActive}>
              Export this theme
            </Button>
            <Button size="sm" icon={Copy} onClick={() => void share()}>
              Share
            </Button>
            <Button size="sm" icon={PencilLine} onClick={() => setEditing(active)}>
              Duplicate and edit…
            </Button>
            {isBuiltInThemeId(active.id) ? null : (
              <Button
                size="sm"
                variant="destructive"
                icon={Trash2}
                onClick={() => {
                  removeCustomTheme(active.id);
                  setNotice(`Removed “${active.name}”. Back to Classic.`);
                }}
              >
                Remove
              </Button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="fm-sr-only"
              aria-label="Choose a theme file"
              onChange={(event) => void onImportFile(event)}
            />
          </div>
          {problems ? (
            <div className="fm-themes__problems">
              <Banner tone="warning">
                <b>That theme file couldn't be used.</b>
                <ul>
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </Banner>
            </div>
          ) : null}
          {notice ? (
            <div className="fm-themes__problems">
              <Banner tone="info">{notice}</Banner>
            </div>
          ) : null}
          {editing ? (
            <ThemeEditorSheet
              base={editing}
              onClose={() => setEditing(null)}
              onSaved={(theme) => {
                setEditing(null);
                setNotice(`Saved “${theme.name}” under My themes and switched to it.`);
              }}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

export function ThemePreviewCard({
  theme,
  checked,
  onChoose,
  onPreviewStart,
  onPreviewEnd,
}: {
  readonly theme: SkycotTheme;
  readonly checked: boolean;
  readonly onChoose: () => void;
  readonly onPreviewStart?: () => void;
  readonly onPreviewEnd?: () => void;
}) {
  const id = useId();
  const classes = [
    "fm-theme-card",
    theme.flavour.borders === "sketch" ? "fm-theme-card--sketch" : "",
    `fm-theme-card--${theme.flavour.accentShape}`,
    `fm-theme-card--${theme.flavour.labels}`,
  ]
    .filter(Boolean)
    .join(" ");
  const style = {
    "--tc-bg": theme.preview.bg,
    "--tc-surface": theme.preview.surface,
    "--tc-accent": theme.preview.accent,
    "--tc-text": theme.preview.text,
  } as React.CSSProperties;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-labelledby={`${id}-name`}
      aria-describedby={theme.description ? `${id}-desc` : undefined}
      className={classes}
      onClick={onChoose}
      onMouseEnter={onPreviewStart}
      onMouseLeave={onPreviewEnd}
      onFocus={onPreviewStart}
      onBlur={onPreviewEnd}
    >
      <span className="fm-theme-card__frame" style={style} aria-hidden>
        <span className="fm-theme-card__bar">
          <i />
          <i />
          <i />
        </span>
        <span className="fm-theme-card__body">
          <span className="fm-theme-card__label" />
          <span className="fm-theme-card__crew" />
          <span className="fm-theme-card__me" />
        </span>
        {theme.crew && theme.flavour.avatars === "characters" ? (
          <span className="fm-theme-card__faces">
            <MiniFace color={theme.crew.builder.color} ink={theme.preview.text} />
            <MiniFace color={theme.crew.checker.color} ink={theme.preview.text} />
          </span>
        ) : null}
        <span className="fm-theme-card__button" />
        {checked ? (
          <span className="fm-theme-card__tick">
            <Check size={12} strokeWidth={3} />
          </span>
        ) : null}
      </span>
      <span className="fm-theme-card__text">
        <span id={`${id}-name`} className="fm-theme-card__name">
          {theme.name}
        </span>
        {theme.description ? (
          <span id={`${id}-desc`} className="fm-theme-card__desc">
            {theme.description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function MiniFace({ color, ink }: { readonly color: string; readonly ink: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r="26" fill={color} stroke={ink} strokeWidth="4" />
      <circle cx="24" cy="30" r="3" fill={ink} />
      <circle cx="40" cy="30" r="3" fill={ink} />
      <path
        d="M24 42c3 3 13 3 16 0"
        fill="none"
        stroke={ink}
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
