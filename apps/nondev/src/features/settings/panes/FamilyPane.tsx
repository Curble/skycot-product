import type { EnvironmentId } from "@t3tools/contracts";
import { deviceTimeZone } from "../../../plain/daylight";
import { grownUpSwitchLines } from "../../../plain/switches";
import {
  ArrowLeftRight,
  CalendarDays,
  KeyRound,
  Mic,
  Plus,
  Power,
  Users,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";

import { AdvancedModeSheet } from "../../../app/AdvancedModeSheet";
import { navigate, recapHref } from "../../../router";
import { Banner } from "../../../ui/Banner";
import { Button } from "../../../ui/Button";
import { Sheet } from "../../../ui/Sheet";
import { ListExtra, ListRow } from "../../../ui/ListRow";
import { Pill } from "../../../ui/Pill";
import { StepBadge } from "../../../ui/StepBadge";
import { TextField } from "../../../ui/TextField";
import { ChildAvatar } from "../../family/ChildAvatar";
import { ChildEditorSheet } from "../../family/ChildEditorSheet";
import {
  askedEachStepLine,
  childLabel,
  MAX_CHILDREN,
  namesList,
  type FamilyChild,
} from "../../family/children";
import {
  codeChangeWarning,
  codeChangedNotice,
  familyCopy,
  grownUpPlainNames,
} from "../../family/copy";
import { openChildPicker } from "../../family-limits/FamilyLimitsHost";
import { clockPhrase, limitsSummary, todaySummary } from "../../family-limits/limits";
import { refreshToday, useLimits, type ChildToday } from "../../family-limits/store";
import {
  CODE_MAX,
  codeStrength,
  digitsOnly,
  isValidCode,
  setupProblem,
  strengthHint,
  type FamilySetupDraft,
} from "../../family/family";
import { FamilyAssistantsGroup } from "../../family/FamilyAssistantsGroup";
import { PageInternetGroup } from "../../family/PageInternetGroup";
import { ProjectApprovalsGroup } from "../../family/ProjectApprovalsGroup";
import { TrustedAddOnsGroup } from "../../family/TrustedAddOnsGroup";
import { FamilyHonestyBox } from "../../family/FamilySetupForm";
import { FamilySetupSheet } from "../../family/FamilySetupSheet";
import { useFamily } from "../../family/FamilyProvider";
import { DevicesGroup, GrownUpsGroup, ThisDeviceRow } from "../../family/PeopleAndDevices";
import { RelayGroup } from "../../family/RelayGroup";
import { ParentCodeEntry, useParentCodeEntry } from "../../family/ParentCodeEntry";
import { changeParentCode, moveLegacyProfile } from "../../family/store";
import { speechService } from "../../voice/browser";
import { whereVoiceGoes } from "../../voice/copy";
import { useFamilyVoiceTypingOff, writeFamilyVoiceTypingOff } from "../localPrefs";
import { Switch } from "../../../ui/Switch";
import { SettingsGroup } from "../SettingsGroup";

/**
 * Settings → Family. Off: one row that opens the same set-up as the welcome
 * steps. On: the status card, the parent-code rows (each asks for the current
 * code inline, never in a separate popup), the one way into Advanced mode, and
 * the way out. Every code prompt is sober, whatever the theme.
 */
export function FamilyPane({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const family = useFamily();
  const [setupOpen, setSetupOpen] = useState(false);

  if (family.profile.legacy && !family.profile.enabled) return <MoveLegacyPane />;

  if (!family.enabled) {
    return (
      <>
        <SettingsGroup
          title={familyCopy.title}
          footer="For a child you look after. Turning it on applies the Workshop look (unless you've already picked another), lets safe steps run by themselves while anything risky waits for a grown-up, hides the developer tools, and guards publishing and automations with a parent code."
        >
          <ListRow
            leading={<StepBadge state="todo" icon={Users} />}
            title={`Set up the ${familyCopy.title}`}
            subtitle="Takes a minute: a name for the greeting, and a 4–6 digit parent code."
            trailing={
              <Button size="sm" variant="primary" onClick={() => setSetupOpen(true)}>
                Set up…
              </Button>
            }
          />
        </SettingsGroup>
        <SettingsGroup title="What it does and does not do">
          <ListExtra>
            <div className="fm-sheet-inset">
              <FamilyHonestyBox />
            </div>
          </ListExtra>
        </SettingsGroup>
        <FamilySetupSheet
          open={setupOpen}
          onClose={() => setSetupOpen(false)}
          environmentId={environmentId}
        />
      </>
    );
  }

  return <FamilyOnPane environmentId={environmentId} />;
}

type Row = "code" | "reset" | "off" | null;

function FamilyOnPane({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { profile, requireParentCode } = useFamily();
  const [openRow, setOpenRow] = useState<Row>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const since = profile.createdAt ? formatSince(profile.createdAt) : null;
  const names = profile.children.map((child, index) => childLabel(child, index));
  const askedLine = askedEachStepLine(profile.children);

  // Confirm first; the code sheet then turns it off on the engine in the same step.
  const turnOff = async () => {
    setConfirmOff(false);
    await requireParentCode("disableFamily");
  };

  return (
    <>
      <SettingsGroup title="Status">
        <ListExtra>
          <div className="fm-family-status">
            <span className="fm-family-status__glyph" aria-hidden>
              <Users size={20} strokeWidth={1.8} />
            </span>
            <span className="fm-family-status__text">
              <b>{familyCopy.title} is on</b>
              <small>
                {names.length > 1
                  ? `For ${namesList(names)}`
                  : profile.childName
                    ? `Set up for ${profile.childName}`
                    : "No name given"}
                {since ? ` · since ${since}` : ""}
              </small>
            </span>
            <span style={{ marginLeft: "auto" }}>
              <Pill tone="ok" size="sm">
                On
              </Pill>
            </span>
          </div>
        </ListExtra>
        <ListRow
          leading={<StepBadge state="ok" />}
          title="Safe steps run by themselves"
          subtitle={`Anything risky waits for a grown-up, whatever a setting or an older conversation says. ${askedLine}`}
        />
      </SettingsGroup>

      <ChildrenGroup />

      {profile.me.kind === "shared" ? (
        <>
          <GrownUpsGroup />
          <DevicesGroup />
          <RelayGroup />
        </>
      ) : null}

      <FamilyAssistantsGroup environmentId={environmentId} />

      <TrustedAddOnsGroup />
      <PageInternetGroup />
      <ProjectApprovalsGroup />

      <SettingsGroup title="Parent code" footer={familyCopy.storage}>
        <ListRow
          leading={<StepBadge state="todo" icon={KeyRound} />}
          title="Change parent code"
          subtitle="Enter the current code, then a new one. One code for every child."
          expanded={openRow === "code"}
          onClick={() => setOpenRow(openRow === "code" ? null : "code")}
        />
        {openRow === "code" ? (
          <ListExtra>
            <ChangeCodeForm onDone={() => setOpenRow(null)} />
          </ListExtra>
        ) : null}
        <ListRow
          leading={<StepBadge state="todo" icon={KeyRound} />}
          title="Forgot the code?"
          subtitle="Follow the reset steps on this Mac. This turns the Family profile off."
          expanded={openRow === "reset"}
          onClick={() => setOpenRow(openRow === "reset" ? null : "reset")}
        />
        {openRow === "reset" ? (
          <ListExtra>
            <div className="fm-family-inline">
              <p>To start again without the old code:</p>
              <ol>
                <li>Quit SKYCOT.</li>
                <li>In Finder, choose Go → Go to Folder…</li>
                <li>
                  Open <code>~/.skycot/userdata</code>.
                </li>
                <li>
                  Move <code>skycot-family.json</code> to the Bin.
                </li>
                <li>Open SKYCOT and set up the Family profile again.</li>
              </ol>
              <Banner tone="warning">
                This removes the children, grown-ups, limits and linked grown-up devices from this
                Mac.
              </Banner>
            </div>
          </ListExtra>
        ) : null}
      </SettingsGroup>

      <FamilyVoiceGroup childName={profile.childName} />

      {profile.me.kind === "shared" ? (
        <SettingsGroup
          title="Developer tools"
          footer="The full workshop is hidden from the sidebar and Settings while the profile is on. A parent can still open it here."
        >
          <ListRow
            leading={<StepBadge state="todo" icon={Wrench} />}
            title={`${grownUpPlainNames.advanced} (parent code)`}
            subtitle="The full developer interface. It stays open on this device for 15 minutes."
            trailing={
              <Button size="sm" onClick={() => setAdvancedOpen(true)}>
                Open…
              </Button>
            }
          />
        </SettingsGroup>
      ) : null}

      <SettingsGroup title="Turn off" footer={familyCopy.honesty}>
        <ListRow
          leading={<StepBadge state="warn" icon={Power} />}
          title={`Turn off the ${familyCopy.title}`}
          subtitle="Confirms, then asks for the parent code. The look and text size stay as they are; autonomy, Advanced mode and publishing open up again."
          trailing={
            <Button size="sm" variant="destructive" onClick={() => setConfirmOff(true)}>
              Turn off…
            </Button>
          }
        />
      </SettingsGroup>

      <SettingsGroup title="What it does and does not do">
        <ListExtra>
          <div className="fm-sheet-inset">
            <FamilyHonestyBox />
          </div>
        </ListExtra>
      </SettingsGroup>

      <AdvancedModeSheet open={advancedOpen} onClose={() => setAdvancedOpen(false)} />
      <Sheet
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        icon={Power}
        iconTone="red"
        title={`Turn off the ${familyCopy.title}?`}
        description="Every guardrail it added goes: the assistant can be set to do more on its own, Advanced mode comes back, and publishing, the internet and installs no longer ask for a code. The child's name and the code are forgotten."
        sober
        dismissOnBackdrop={false}
        actions={
          <>
            <Button onClick={() => setConfirmOff(false)}>Keep it on</Button>
            <Button variant="destructive" filled onClick={() => void turnOff()}>
              Enter parent code…
            </Button>
          </>
        }
      />
    </>
  );
}

/**
 * The parent's switch for voice typing. It lives on this device (the microphone is the
 * browser's, not the engine's), and changing it either way needs the parent code, checked by
 * the engine, so the child's own Voice settings cannot turn it back on.
 */
function FamilyVoiceGroup({ childName }: { readonly childName: string | null }) {
  const { requireParentCode } = useFamily();
  const off = useFamilyVoiceTypingOff();
  const who = childName ?? "the child";
  return (
    <SettingsGroup
      title="Voice"
      footer={`${whereVoiceGoes(speechService)} SKYCOT never records or keeps the sound. Each child's voice typing is off until a parent turns it on in their settings above; this switch can keep it off on this device for everyone.`}
    >
      <ListRow
        leading={<StepBadge state={off ? "todo" : "ok"} icon={Mic} />}
        title="Voice typing on this device (parent code)"
        subtitle={
          off
            ? `Off on this device. ${who.charAt(0).toUpperCase()}${who.slice(1)} types instead.`
            : `On. ${who.charAt(0).toUpperCase()}${who.slice(1)} can tap the microphone to talk instead of typing; listening stops after a minute, or when SKYCOT is in the background.`
        }
        trailing={
          <Switch
            checked={!off}
            onChange={(on) =>
              void requireParentCode("voiceSettings").then((ok) => {
                if (ok) writeFamilyVoiceTypingOff(!on);
              })
            }
            label="Voice typing"
          />
        }
      />
    </SettingsGroup>
  );
}

function ChangeCodeForm({ onDone }: { readonly onDone: () => void }) {
  // The engine checks the current code and sets the new one in one request, so the current
  // code is only held here between the two steps.
  const [current, setCurrent] = useState<string | null>(null);
  const [currentDraft, setCurrentDraft] = useState("");
  const [draft, setDraft] = useState<FamilySetupDraft>({ childName: "", code: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const problem = setupProblem(draft);
  const strength = codeStrength(draft.code);

  if (saved) {
    return (
      <div className="fm-family-inline" data-sober="">
        <Banner tone="info">{codeChangedNotice}</Banner>
        <div className="fm-family-inline__actions">
          <Button size="sm" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  if (current === null) {
    return (
      <div className="fm-family-inline" data-sober="">
        <TextField
          label="Current parent code"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={CODE_MAX}
          autoFocus
          value={currentDraft}
          onChange={(event) => setCurrentDraft(digitsOnly(event.currentTarget.value))}
        />
        {failure ? <Banner tone="warning">{failure}</Banner> : null}
        <div className="fm-family-inline__actions">
          <Button size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!isValidCode(currentDraft)}
            onClick={() => {
              setFailure(null);
              setCurrent(currentDraft);
            }}
          >
            Next
          </Button>
        </div>
      </div>
    );
  }

  const save = async () => {
    setBusy(true);
    const result = await changeParentCode(current, draft.code);
    setBusy(false);
    if (result.ok) {
      setSaved(true);
      return;
    }
    // A wrong current code goes back to that step with the engine's sentence.
    setFailure(result.message);
    if (result.reason === "wrong-code" || result.reason === "locked") {
      setCurrent(null);
      setCurrentDraft("");
    }
  };

  return (
    <div className="fm-family-inline" data-sober="">
      <Banner tone="warning">{codeChangeWarning}</Banner>
      <div className="fm-family-inline__row">
        <TextField
          label="New parent code"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={CODE_MAX}
          autoFocus
          value={draft.code}
          onChange={(event) => setDraft({ ...draft, code: digitsOnly(event.currentTarget.value) })}
        />
        <TextField
          label="Type it again"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={CODE_MAX}
          value={draft.confirm}
          onChange={(event) =>
            setDraft({ ...draft, confirm: digitsOnly(event.currentTarget.value) })
          }
        />
      </div>
      <p className="fm-help" role="status">
        {strengthHint(strength, draft.code.length)}
      </p>
      {problem !== null && draft.confirm.length > 0 ? (
        <Banner tone="warning">{problem}</Banner>
      ) : null}
      {failure ? <Banner tone="warning">{failure}</Banner> : null}
      <div className="fm-family-inline__actions">
        <Button size="sm" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={problem !== null || busy}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save new code"}
        </Button>
      </div>
    </div>
  );
}

/** A profile from before the engine kept it: one code entry carries it over. */
function MoveLegacyPane() {
  const entry = useParentCodeEntry(
    async (code) => {
      const problem = await moveLegacyProfile(code);
      return problem === null
        ? { ok: true, value: null }
        : { ok: false, reason: "wrong-code", message: problem };
    },
    () => undefined,
  );
  return (
    <>
      <SettingsGroup title={familyCopy.legacyTitle} footer={familyCopy.honesty}>
        <ListExtra>
          <div className="fm-family-inline" data-sober="">
            <Banner tone="warning">{familyCopy.legacyBody}</Banner>
            <ParentCodeEntry entry={entry} autoFocus />
            <div className="fm-family-inline__actions">
              <Button
                size="sm"
                variant="primary"
                disabled={!entry.canSubmit}
                onClick={() => void entry.submit()}
              >
                {entry.busy ? "Moving…" : "Move to the engine"}
              </Button>
            </div>
          </div>
        </ListExtra>
      </SettingsGroup>
      <SettingsGroup title="What it does and does not do">
        <ListExtra>
          <div className="fm-sheet-inset">
            <FamilyHonestyBox />
          </div>
        </ListExtra>
      </SettingsGroup>
    </>
  );
}

function formatSince(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// "Today" changes once a minute at most: re-read the engine's numbers while the pane is open.
const TODAY_REFRESH_MS = 60_000;

/** One card per child, "Add another child", and who is using SKYCOT on this device. */
function ChildrenGroup() {
  const { profile, requireParentCode } = useFamily();
  const { today } = useLimits();
  const [editing, setEditing] = useState<{ readonly child: FamilyChild | null } | null>(null);
  useEffect(() => {
    void refreshToday();
    const timer = window.setInterval(() => void refreshToday(), TODAY_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);
  const children = profile.children;
  const several = children.length > 1;
  const current = children.find((child) => child.id === profile.currentChildId) ?? null;
  const open = (child: FamilyChild | null) =>
    void requireParentCode("manageChildren").then((ok) => {
      if (ok) setEditing({ child });
    });
  const timeZone = profile.timeZone ?? deviceTimeZone();
  return (
    <>
      <SettingsGroup
        title={several ? "Children" : "Child"}
        footer="Names, pictures, looks, voice, limits and “Ask before each step” need the parent code. Choosing who's using SKYCOT doesn't, except to move away from a child it's asleep for."
      >
        <ListExtra>
          <div>
            {children.map((child, index) => (
              <ChildCard
                key={child.id}
                child={child}
                label={childLabel(child, index)}
                here={several && child.id === profile.currentChildId}
                today={today.children.find((entry) => entry.childId === child.id) ?? null}
                timeZone={timeZone}
                onEdit={() => open(child)}
              />
            ))}
          </div>
        </ListExtra>
        {children.length < MAX_CHILDREN ? (
          <ListRow
            leading={<StepBadge state="todo" icon={Plus} />}
            title="Add another child"
            subtitle="Their own picture, look, bedtime and limits, under the same parent code."
            trailing={
              <Button size="sm" onClick={() => open(null)}>
                Add…
              </Button>
            }
          />
        ) : null}
        <ThisDeviceRow />
        {several && profile.me.kind === "shared" ? (
          <ListRow
            leading={<StepBadge state="todo" icon={ArrowLeftRight} />}
            title="Who's using SKYCOT on this device"
            subtitle={current ? `${current.name ?? "A child"} right now.` : "Nobody chosen yet."}
            trailing={
              <Button size="sm" onClick={openChildPicker}>
                Switch…
              </Button>
            }
          />
        ) : null}
      </SettingsGroup>
      {editing ? (
        <ChildEditorSheet
          child={editing.child}
          siblings={children.length}
          canRemove={several}
          onClose={() => {
            setEditing(null);
            void refreshToday();
          }}
        />
      ) : null}
    </>
  );
}

function ChildCard({
  child,
  label,
  here,
  today,
  timeZone,
  onEdit,
}: {
  readonly child: FamilyChild;
  readonly label: string;
  readonly here: boolean;
  readonly today: ChildToday | null;
  readonly timeZone: string;
  readonly onEdit: () => void;
}) {
  const state = today?.limits ?? null;
  const share =
    state !== null && child.limits.dailyMinutes !== null
      ? Math.min(1, state.usedMinutes / child.limits.dailyMinutes)
      : null;
  const extras = today?.moreTime ?? [];
  const switched = grownUpSwitchLines(today?.switches ?? [], (at) => clockPhrase(at, timeZone));
  return (
    <div className="fm-child-card">
      <ChildAvatar child={child} size={52} />
      <div className="fm-child-card__text">
        <span className="fm-child-card__name">
          {label}
          {here ? (
            <Pill tone="ok" size="sm">
              On this device
            </Pill>
          ) : null}
          {state?.asleep ? (
            <Pill tone="neutral" size="sm">
              Asleep
            </Pill>
          ) : null}
        </span>
        <span className="fm-child-card__line">{limitsSummary(child.limits)}</span>
        <span className="fm-child-card__line">
          Voice typing {child.voice.typing ? "on" : "off"} · read aloud{" "}
          {child.voice.readAloud ? "on" : "off"}
          {child.largerText ? " · larger text" : ""}
        </span>
        <span className="fm-child-card__line">
          {child.askEachStep
            ? "Asked before each step"
            : "Safe steps run by themselves · anything risky waits for a grown-up"}
        </span>
        {state !== null ? (
          <span className="fm-child-card__today">{todaySummary(state, child.limits)}</span>
        ) : null}
        {share !== null ? (
          <span
            className={`fm-child-card__meter${state?.asleep ? " fm-child-card__meter--asleep" : ""}`}
            role="img"
            aria-label={`${Math.round(share * 100)}% of today's time used`}
          >
            <span style={{ width: `${Math.round(share * 100)}%` }} />
          </span>
        ) : null}
        {extras.length > 0 ? (
          <span className="fm-child-card__line">
            {extras
              .map((entry) =>
                entry.kind === "extra"
                  ? `A grown-up added ${entry.minutes ?? 15} minutes at ${clockPhrase(entry.at, timeZone)}`
                  : `A grown-up ended bedtime at ${clockPhrase(entry.at, timeZone)}`,
              )
              .join(" · ")}
          </span>
        ) : null}
        {switched.length > 0 ? (
          <span className="fm-child-card__line">{switched.join(" ")}</span>
        ) : null}
      </div>
      <div className="fm-child-card__actions">
        <Button size="sm" icon={CalendarDays} onClick={() => navigate(recapHref(child.id))}>
          {label}'s week
        </Button>
        <Button size="sm" onClick={onEdit}>
          Edit…
        </Button>
      </div>
    </div>
  );
}
