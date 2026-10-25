// Settings › Family → a child's card → Edit (or "Add another child"): name, picture, look,
// larger text, voice, how steps are asked, bedtime and daily limits, in one sober sheet. Opened only after the
// parent code (the engine refuses the save otherwise). Voice typing asks the parent to read
// where this browser sends the child's voice before it goes on.
import { Mic, Moon, UserRound } from "lucide-react";
import { useId, useState } from "react";

import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { Switch } from "../../ui/Switch";
import { TextField } from "../../ui/TextField";
import { useThemes } from "../../themes/store";
import { speechService } from "../voice/browser";
import { whereChildVoiceGoes } from "../voice/copy";
import {
  DAILY_MINUTE_OPTIONS,
  DAILY_TURN_OPTIONS,
  durationPhrase,
  KEEP_ALLOWANCE_OPTIONS,
} from "../family-limits/limits";
import type { ChildPatch } from "./api";
import { AVATAR_CHARACTERS, CHARACTER_NAMES } from "./characters";
import { ChildAvatar } from "./ChildAvatar";
import {
  AVATAR_COLORS,
  AVATAR_POSES,
  COLOR_NAMES,
  DEFAULT_VOICE,
  NO_LIMITS,
  DEFAULT_READING_LEVEL,
  READING_LEVELS,
  POSE_NAMES,
  type ChildAvatar as Avatar,
  type FamilyChild,
  type ReadingLevel,
} from "./children";
import { addChild, removeChild, updateChild } from "./store";

export interface ChildDraft {
  readonly name: string;
  readonly avatar: Avatar;
  readonly look: string;
  readonly largerText: boolean;
  readonly voiceTyping: boolean;
  readonly readAloud: boolean;
  readonly bedtimeOn: boolean;
  readonly bedtimeStart: string;
  readonly bedtimeEnd: string;
  readonly dailyMinutes: number | null;
  readonly dailyTurns: number | null;
  readonly keepAllowancePercent: number | null;
  /** "Ask [child] before each step": off by default (safe steps run by themselves). */
  readonly askEachStep: boolean;
  readonly readingLevel: ReadingLevel;
}

export function draftFor(child: FamilyChild | null, siblings: number): ChildDraft {
  const limits = child?.limits ?? NO_LIMITS;
  const voice = child?.voice ?? DEFAULT_VOICE;
  return {
    name: child?.name ?? "",
    avatar: child?.avatar ?? {
      kind: "initial",
      color: AVATAR_COLORS[siblings % AVATAR_COLORS.length]!,
    },
    look: child?.look ?? "workshop",
    largerText: child?.largerText ?? true,
    voiceTyping: voice.typing,
    readAloud: voice.readAloud,
    bedtimeOn: limits.bedtime !== null,
    bedtimeStart: limits.bedtime?.start ?? "19:30",
    bedtimeEnd: limits.bedtime?.end ?? "07:00",
    dailyMinutes: limits.dailyMinutes,
    dailyTurns: limits.dailyTurns,
    keepAllowancePercent: limits.keepAllowancePercent,
    askEachStep: child?.askEachStep ?? false,
    readingLevel: child?.readingLevel ?? DEFAULT_READING_LEVEL,
  };
}

/** The draft as the engine's patch: every field, so the sheet's view is what gets saved. */
export function patchFor(draft: ChildDraft): ChildPatch {
  return {
    name: draft.name.trim() || null,
    avatar: draft.avatar,
    look: draft.look,
    largerText: draft.largerText,
    voice: { typing: draft.voiceTyping, readAloud: draft.readAloud },
    limits: {
      bedtime: draft.bedtimeOn ? { start: draft.bedtimeStart, end: draft.bedtimeEnd } : null,
      dailyMinutes: draft.dailyMinutes,
      dailyTurns: draft.dailyTurns,
      keepAllowancePercent: draft.keepAllowancePercent,
    },
    askEachStep: draft.askEachStep,
    readingLevel: draft.readingLevel,
  };
}

/** "Ask Ava before each step". */
export function askEachStepTitle(name: string): string {
  const trimmed = name.trim();
  return `Ask ${trimmed || "them"} before each step`;
}

/** The line under the switch: what each position does, in a parent's words. */
export function askEachStepHelp(on: boolean, who: string): string {
  return on
    ? `On: ${who} is asked before every step, even safe ones like looking at files. Anything risky still waits for a grown-up.`
    : `Off: safe steps inside the project run by themselves, so ${who} isn't asked about every step. Anything risky (the internet, installs, deleting, other folders) still waits for a grown-up, a page that loads things from the internet asks a grown-up once, and ${who} still sees the plan before anything is built.`;
}

/** Why the draft can't be saved, or null. */
export function draftProblem(draft: ChildDraft): string | null {
  if (draft.bedtimeOn && draft.bedtimeStart === draft.bedtimeEnd) {
    return "Bedtime needs a start and an end that are different times.";
  }
  if (draft.bedtimeOn && (!draft.bedtimeStart || !draft.bedtimeEnd))
    return "Choose when bedtime starts and ends.";
  return null;
}

export function ChildEditorSheet({
  child,
  siblings,
  canRemove,
  onClose,
}: {
  /** null: adding a new child. */
  readonly child: FamilyChild | null;
  readonly siblings: number;
  readonly canRemove: boolean;
  readonly onClose: () => void;
}) {
  const [draft, setDraft] = useState<ChildDraft>(() => draftFor(child, siblings));
  const [voiceAsk, setVoiceAsk] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const themes = useThemes();
  const ids = {
    look: useId(),
    minutes: useId(),
    turns: useId(),
    keep: useId(),
    start: useId(),
    end: useId(),
  };
  const problem = draftProblem(draft);
  const who = draft.name.trim() || (child === null ? "this child" : "your child");
  const voice = whereChildVoiceGoes(speechService, draft.name.trim() || null);
  const change = (patch: Partial<ChildDraft>) => setDraft({ ...draft, ...patch });

  const save = async () => {
    if (problem !== null || busy) return;
    setBusy(true);
    setFailure(null);
    const result =
      child === null
        ? await addChild(patchFor(draft))
        : await updateChild(child.id, patchFor(draft));
    setBusy(false);
    if (result.ok) onClose();
    else setFailure(result.message);
  };

  const remove = async () => {
    if (child === null) return;
    setBusy(true);
    const result = await removeChild(child.id);
    setBusy(false);
    if (result.ok) onClose();
    else setFailure(result.message);
  };

  return (
    <Sheet
      open
      onClose={onClose}
      icon={UserRound}
      iconTone="orange"
      title={child === null ? "Add another child" : `${child.name ?? "Your child"}'s settings`}
      description="Their own picture, look, voice, steps and limits. SKYCOT's engine keeps them on this Mac and holds every limit, whatever device they use."
      wide
      sober
      initialFocus="first"
      dismissOnBackdrop={false}
      actions={
        <>
          {child !== null && canRemove ? (
            <Button variant="destructive" onClick={() => setConfirmRemove(true)} disabled={busy}>
              Remove…
            </Button>
          ) : null}
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={problem !== null || busy}>
            {busy ? "Saving…" : child === null ? "Add child" : "Save"}
          </Button>
        </>
      }
    >
      <div className="fm-child-editor">
        <section className="fm-child-editor__section">
          <TextField
            label="First name (optional)"
            placeholder="Leo"
            autoComplete="off"
            maxLength={40}
            value={draft.name}
            onChange={(event) => change({ name: event.currentTarget.value })}
          />
          <p className="fm-help">For the greeting and the picker. It stays on this Mac.</p>
        </section>

        <section className="fm-child-editor__section">
          <h3>Picture</h3>
          <div className="fm-child-editor__pictures" role="radiogroup" aria-label="Picture">
            {/* Drawn pictures only for children, to keep them private (no photos). */}
            {AVATAR_CHARACTERS.map((id) => (
              <PictureChoice
                key={id}
                avatar={{ kind: "character", id }}
                name={draft.name}
                label={CHARACTER_NAMES[id]}
                selected={draft.avatar.kind === "character" && draft.avatar.id === id}
                onSelect={(avatar) => change({ avatar })}
              />
            ))}
            {AVATAR_COLORS.map((color) => (
              <PictureChoice
                key={color}
                avatar={{ kind: "initial", color }}
                name={draft.name}
                label={`${COLOR_NAMES[color]} letter`}
                selected={draft.avatar.kind === "initial" && draft.avatar.color === color}
                onSelect={(avatar) => change({ avatar })}
              />
            ))}
            {AVATAR_POSES.map((pose) => (
              <PictureChoice
                key={pose}
                avatar={{ kind: "mascot", pose }}
                name={draft.name}
                label={`SKYCOT ${POSE_NAMES[pose].toLowerCase()}`}
                selected={draft.avatar.kind === "mascot" && draft.avatar.pose === pose}
                onSelect={(avatar) => change({ avatar })}
              />
            ))}
          </div>
        </section>

        <section className="fm-child-editor__section">
          <h3>Look</h3>
          <label className="fm-sr-only" htmlFor={ids.look}>
            Look
          </label>
          <select
            id={ids.look}
            value={draft.look}
            onChange={(event) => change({ look: event.currentTarget.value })}
          >
            {themes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </select>
          <div className="fm-child-editor__row">
            <span>
              Larger text
              <small>Easier to read; {who} can change it in Appearance.</small>
            </span>
            <Switch
              checked={draft.largerText}
              onChange={(on) => change({ largerText: on })}
              label="Larger text"
            />
          </div>
        </section>

        <section className="fm-child-editor__section">
          <h3>Voice</h3>
          <div className="fm-child-editor__row">
            <span>
              Read answers aloud
              <small>
                A voice on this Mac reads the replies; nothing is sent anywhere to be spoken.
              </small>
            </span>
            <Switch
              checked={draft.readAloud}
              onChange={(on) => change({ readAloud: on })}
              label="Read answers aloud"
            />
          </div>
          <div className="fm-child-editor__row">
            <span>
              Voice typing
              <small>
                {draft.voiceTyping
                  ? `On: ${who} can talk instead of typing.`
                  : "Off. Talking instead of typing sends the voice to the browser's speech service."}
              </small>
            </span>
            <Switch
              checked={draft.voiceTyping}
              onChange={(on) => (on ? setVoiceAsk(true) : change({ voiceTyping: false }))}
              label="Voice typing"
            />
          </div>
          {voiceAsk ? (
            <div className="fm-sheet-inset">
              <Banner tone="info">
                <b>Where the voice goes.</b> {voice.where}
                {voice.advice ? ` ${voice.advice}` : ""} SKYCOT never records or keeps the sound.
              </Banner>
              <div className="fm-family-inline__actions">
                <Button size="sm" onClick={() => setVoiceAsk(false)}>
                  Keep it off
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon={Mic}
                  onClick={() => {
                    change({ voiceTyping: true });
                    setVoiceAsk(false);
                  }}
                >
                  Turn voice typing on
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="fm-child-editor__section">
          <h3>Reading level</h3>
          <label>
            How Sam explains things
            <select
              value={draft.readingLevel}
              onChange={(event) =>
                change({ readingLevel: event.currentTarget.value as ReadingLevel })
              }
            >
              {READING_LEVELS.map((level, index) => (
                <option key={level} value={level}>
                  {["Little makers (5–7)", "Makers (8–10)", "Big makers (11–13)"][index]}
                </option>
              ))}
            </select>
          </label>
        </section>
        <section className="fm-child-editor__section">
          <h3>Steps</h3>
          <div className="fm-child-editor__row">
            <span>
              {askEachStepTitle(draft.name)}
              <small>{askEachStepHelp(draft.askEachStep, who)}</small>
            </span>
            <Switch
              checked={draft.askEachStep}
              onChange={(on) => change({ askEachStep: on })}
              label={askEachStepTitle(draft.name)}
            />
          </div>
        </section>

        <section className="fm-child-editor__section">
          <h3>Bedtime</h3>
          <div className="fm-child-editor__row">
            <span>
              Bedtime
              <small>
                SKYCOT finishes the step it's on, then sleeps until morning. A grown-up can give
                more time.
              </small>
            </span>
            <Switch
              checked={draft.bedtimeOn}
              onChange={(on) => change({ bedtimeOn: on })}
              label="Bedtime"
            />
          </div>
          {draft.bedtimeOn ? (
            <div className="fm-child-editor__times">
              <TextField
                label="Sleeps at"
                type="time"
                value={draft.bedtimeStart}
                onChange={(event) => change({ bedtimeStart: event.currentTarget.value })}
              />
              <TextField
                label="Wakes at"
                type="time"
                value={draft.bedtimeEnd}
                onChange={(event) => change({ bedtimeEnd: event.currentTarget.value })}
              />
            </div>
          ) : null}
        </section>

        <section className="fm-child-editor__section">
          <h3>Each day</h3>
          <LimitSelect
            id={ids.minutes}
            label="Time on SKYCOT"
            value={draft.dailyMinutes}
            options={DAILY_MINUTE_OPTIONS}
            describe={(minutes) => `Up to ${durationPhrase(minutes)}`}
            onChange={(dailyMinutes) => change({ dailyMinutes })}
          />
          <LimitSelect
            id={ids.turns}
            label="Messages to SKYCOT"
            value={draft.dailyTurns}
            options={DAILY_TURN_OPTIONS}
            describe={(turns) => `Up to ${turns} messages`}
            onChange={(dailyTurns) => change({ dailyTurns })}
          />
          <LimitSelect
            id={ids.keep}
            label="Leave for grown-ups"
            value={draft.keepAllowancePercent}
            options={KEEP_ALLOWANCE_OPTIONS}
            describe={(percent) => `Pause when the AI allowance is down to ${percent}%`}
            onChange={(keepAllowancePercent) => change({ keepAllowancePercent })}
          />
          <p className="fm-help">
            Time counts the minutes {who} is using SKYCOT, not the minutes it's open. The AI
            companies report one allowance for the whole account, so SKYCOT can't tell how much each
            child used: the messages count is exact, and "leave for grown-ups" pauses {who}'s
            messages once the account's allowance is down to that share.
          </p>
        </section>

        {problem ? <Banner tone="warning">{problem}</Banner> : null}
        {failure ? <Banner tone="warning">{failure}</Banner> : null}
      </div>
      <Sheet
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        icon={Moon}
        iconTone="red"
        title={`Remove ${child?.name ?? "this child"}?`}
        description="Their picture, look and limits go. Their conversations and projects stay, under everyone else's."
        sober
        actions={
          <>
            <Button onClick={() => setConfirmRemove(false)}>Keep</Button>
            <Button variant="destructive" filled onClick={() => void remove()}>
              Remove
            </Button>
          </>
        }
      />
    </Sheet>
  );
}

function PictureChoice({
  avatar,
  name,
  label,
  selected,
  onSelect,
}: {
  readonly avatar: Avatar;
  readonly name: string;
  readonly label: string;
  readonly selected: boolean;
  readonly onSelect: (avatar: Avatar) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      className="fm-child-editor__picture"
      onClick={() => onSelect(avatar)}
    >
      <ChildAvatar child={{ avatar, name: name.trim() || null }} size={44} />
    </button>
  );
}

function LimitSelect({
  id,
  label,
  value,
  options,
  describe,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: number | null;
  readonly options: ReadonlyArray<number | null>;
  readonly describe: (value: number) => string;
  readonly onChange: (value: number | null) => void;
}) {
  // A value set elsewhere (another device, a hand-edited file) still shows.
  const all = value === null || options.includes(value) ? options : [...options, value];
  return (
    <div className="fm-child-editor__row">
      <label htmlFor={id}>{label}</label>
      <span style={{ minWidth: 220 }}>
        <select
          id={id}
          value={value === null ? "" : String(value)}
          onChange={(event) =>
            onChange(event.currentTarget.value === "" ? null : Number(event.currentTarget.value))
          }
        >
          {all.map((option) => (
            <option key={option ?? "off"} value={option === null ? "" : String(option)}>
              {option === null ? "No limit" : describe(option)}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
