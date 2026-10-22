// The theme picker: live preview cards drawn from each theme's `preview`
// colours and flavour, the active one ticked. A card tries its look on for as
// long as the pointer or keyboard focus rests on it; clicking (Space, Enter)
// keeps it. Settings adds import / export / share / duplicate / remove under the
// grid; onboarding shows the compact grid alone.
import { Check, Copy, Download, PencilLine, Trash2, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { isBuiltInThemeId } from "./library";
import { serializeTheme, type SkycotTheme } from "./schema";
import {
  endPreview,
  importTheme,
  previewTheme,
  readDefaultTheme,
  removeCustomTheme,
  setActiveTheme,
  useActiveTheme,
  useThemes,
} from "./store";
import { ThemeEditorSheet } from "./ThemeEditorSheet";

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
  // A notice may carry the theme it just removed, so Undo can bring it back.
  const [notice, setNotice] = useState<{
    readonly text: string;
    readonly removed?: SkycotTheme;
  } | null>(null);
  const [editing, setEditing] = useState<SkycotTheme | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Leaving the gallery always puts the chosen theme back.
  useEffect(() => () => endPreview(), []);

  // The preview lasts while the pointer or focus is on the card: no timer, so a
  // keyboard user reading a card is not snapped back to the old look mid-thought.
  const startPreview = (theme: SkycotTheme) => {
    if (theme.id === active.id) endPreview();
    else previewTheme(theme);
  };
  const stopPreview = () => endPreview();
  const choose = (theme: SkycotTheme) => {
    stopPreview();
    setActiveTheme(theme.id);
    setNotice(null);
  };

  // Radio-group keyboard pattern: one tab stop, arrows move (and preview), Space/Enter keep.
  const moveWithin = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : event.key === "Home"
            ? -Infinity
            : event.key === "End"
              ? Infinity
              : 0;
    if (delta === 0) return;
    const cards = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
    const index = cards.findIndex((card) => card === document.activeElement);
    if (cards.length === 0) return;
    event.preventDefault();
    const next = !Number.isFinite(delta)
      ? delta < 0
        ? 0
        : cards.length - 1
      : (Math.max(index, 0) + delta + cards.length) % cards.length;
    cards[next]?.focus();
  };

  const remove = () => {
    const theme = active;
    removeCustomTheme(theme.id);
    setConfirmRemove(false);
    setNotice({
      text: `Removed “${theme.name}”. Back to ${readDefaultTheme().name}.`,
      removed: theme,
    });
  };
  const undoRemove = (theme: SkycotTheme) => {
    const outcome = importTheme(theme);
    if (outcome.ok) setActiveTheme(outcome.theme.id);
    setNotice({ text: `“${theme.name}” is back under My themes.` });
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
    setNotice({
      text: outcome.replaced
        ? `Updated “${outcome.theme.name}” and switched to it.`
        : `Added “${outcome.theme.name}” to My themes and switched to it.`,
    });
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
    setProblems(null);
    try {
      await navigator.clipboard.writeText(serializeTheme(active));
      setNotice({
        text: `Copied “${active.name}” as text. Paste it to a friend; they import it from this screen.`,
      });
    } catch {
      setProblems(["Couldn't reach the clipboard. Use “Export this theme” instead."]);
    }
  };

  const grid = (list: ReadonlyArray<SkycotTheme>) => {
    // The ticked card is the group's tab stop; a group without one (My themes
    // while a built-in is active) offers its first card.
    const tabStop = list.find((theme) => theme.id === active.id) ?? list[0];
    return (
      <div
        role="radiogroup"
        aria-label={label}
        className={`fm-themes${compact ? " fm-themes--compact" : ""}`}
        onKeyDown={moveWithin}
      >
        {list.map((theme) => (
          <ThemePreviewCard
            key={theme.id}
            theme={theme}
            checked={theme.id === active.id}
            tabbable={theme === tabStop}
            onChoose={() => choose(theme)}
            onPreviewStart={() => startPreview(theme)}
            onPreviewEnd={stopPreview}
          />
        ))}
      </div>
    );
  };

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
                onClick={() => setConfirmRemove(true)}
              >
                Remove…
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
              <Banner
                tone="info"
                action={
                  notice.removed ? (
                    <Button size="sm" onClick={() => undoRemove(notice.removed!)}>
                      Undo
                    </Button>
                  ) : undefined
                }
              >
                {notice.text}
              </Banner>
            </div>
          ) : null}
          <Sheet
            open={confirmRemove}
            onClose={() => setConfirmRemove(false)}
            icon={Trash2}
            iconTone="red"
            title={`Remove “${active.name}”?`}
            description={`It leaves My themes and this browser, and the look goes back to ${readDefaultTheme().name}. Export it first if you might want it later; Undo in the notice brings it back until you leave this screen.`}
            sober
            dismissOnBackdrop={false}
            actions={
              <>
                <Button onClick={() => setConfirmRemove(false)}>Keep it</Button>
                <Button variant="destructive" filled onClick={remove}>
                  Remove
                </Button>
              </>
            }
          />
          {editing ? (
            <ThemeEditorSheet
              base={editing}
              onClose={() => setEditing(null)}
              onSaved={(theme) => {
                setEditing(null);
                setNotice({ text: `Saved “${theme.name}” under My themes and switched to it.` });
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
  tabbable = true,
  onChoose,
  onPreviewStart,
  onPreviewEnd,
}: {
  readonly theme: SkycotTheme;
  readonly checked: boolean;
  /** Roving tabindex: only one card in a group is in the Tab order. */
  readonly tabbable?: boolean;
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
      tabIndex={tabbable ? 0 : -1}
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
        {theme.crew ? (
          <span className="fm-theme-card__faces">
            {theme.flavour.avatars === "characters" ? (
              <>
                <MiniFace color={theme.crew.builder.color} ink={theme.preview.text} />
                <MiniFace color={theme.crew.checker.color} ink={theme.preview.text} />
              </>
            ) : null}
            <span className="fm-theme-card__crew-names">
              {theme.crew.builder.name} · {theme.crew.checker.name}
            </span>
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
