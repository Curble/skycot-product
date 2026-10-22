import type { EnvironmentId } from "@t3tools/contracts";
import { KeyRound, Mic, PencilLine, Power, Users, Wrench } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { AdvancedModeSheet } from "../../../app/AdvancedModeSheet";
import { ADVANCED_MODE_LABEL } from "../../../brand";
import { Banner } from "../../../ui/Banner";
import { Button } from "../../../ui/Button";
import { Sheet } from "../../../ui/Sheet";
import { ListExtra, ListRow } from "../../../ui/ListRow";
import { Pill } from "../../../ui/Pill";
import { StepBadge } from "../../../ui/StepBadge";
import { TextField } from "../../../ui/TextField";
import { familyCopy } from "../../family/copy";
import {
  CODE_MAX,
  codeStrength,
  digitsOnly,
  isValidCode,
  openGrantsSentence,
  setupProblem,
  strengthHint,
  type FamilySetupDraft,
} from "../../family/family";
import { FamilyHonestyBox } from "../../family/FamilySetupForm";
import { FamilySetupSheet } from "../../family/FamilySetupSheet";
import { useFamily } from "../../family/FamilyProvider";
import { ParentCodeEntry, useParentCodeEntry } from "../../family/ParentCodeEntry";
import {
  changeParentCode,
  lockFamilyGrants,
  moveLegacyProfile,
  renameChild,
} from "../../family/store";
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
          footer="For a child you look after. Turning it on applies the Workshop look (unless you've already picked another), keeps the assistant on “Ask me first”, hides the developer tools, and guards publishing and automations with a parent code."
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

  return <FamilyOnPane />;
}

type Row = "code" | "name" | "off" | null;

// "14 more minutes" only changes once a minute: a coarse clock, read every 30 seconds.
const CLOCK_STEP_MS = 30_000;
const readClock = () => Math.floor(Date.now() / CLOCK_STEP_MS) * CLOCK_STEP_MS;
const subscribeClock = (onChange: () => void) => {
  const timer = window.setInterval(onChange, CLOCK_STEP_MS);
  return () => window.clearInterval(timer);
};

function FamilyOnPane() {
  const { profile, requireParentCode } = useFamily();
  const [openRow, setOpenRow] = useState<Row>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const since = profile.createdAt ? formatSince(profile.createdAt) : null;
  const openLine = openGrantsSentence(profile, useSyncExternalStore(subscribeClock, readClock));

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
                {profile.childName ? `Set up for ${profile.childName}` : "No name given"}
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
          title="Always asks first"
          subtitle="SKYCOT's engine runs every conversation in “Ask me first” while the profile is on, whatever a setting or an older conversation says."
        />
      </SettingsGroup>

      <SettingsGroup title="Parent code and name" footer={familyCopy.storage}>
        <ListRow
          leading={<StepBadge state="todo" icon={KeyRound} />}
          title="Change parent code"
          subtitle="Enter the current code, then a new one."
          expanded={openRow === "code"}
          onClick={() => setOpenRow(openRow === "code" ? null : "code")}
        />
        {openRow === "code" ? (
          <ListExtra>
            <ChangeCodeForm onDone={() => setOpenRow(null)} />
          </ListExtra>
        ) : null}
        <ListRow
          leading={<StepBadge state="todo" icon={PencilLine} />}
          title="Child's name"
          subtitle={
            profile.childName
              ? `“${profile.childName}” — used in the greeting only.`
              : "Not set. Used in the greeting only."
          }
          expanded={openRow === "name"}
          // The engine refuses a rename without the parent's "yes" (QA FK-10).
          onClick={() => {
            if (openRow === "name") {
              setOpenRow(null);
              return;
            }
            void requireParentCode("renameChild").then((ok) => {
              if (ok) setOpenRow("name");
            });
          }}
        />
        {openRow === "name" ? (
          <ListExtra>
            <RenameForm initial={profile.childName ?? ""} onDone={() => setOpenRow(null)} />
          </ListExtra>
        ) : null}
      </SettingsGroup>

      <FamilyVoiceGroup childName={profile.childName} />

      <SettingsGroup
        title="Developer tools"
        footer={`${ADVANCED_MODE_LABEL} is hidden from the sidebar and Settings while the profile is on, and the engine sends its address back here unless a parent has entered the code. A parent can still open it from here.`}
      >
        <ListRow
          leading={<StepBadge state="todo" icon={Wrench} />}
          title={`Open ${ADVANCED_MODE_LABEL} (parent code)`}
          subtitle="The full developer interface. The code opens it on this device for 15 minutes; publishing and approvals there are allowed for that time too."
          trailing={
            <Button size="sm" onClick={() => setAdvancedOpen(true)}>
              Open…
            </Button>
          }
        />
        <ListRow
          leading={<StepBadge state="todo" icon={KeyRound} />}
          title="Lock again now"
          subtitle={
            openLine === null
              ? "Nothing is open on this device. Every “yes” the parent code gives ends on its own, or here."
              : `${openLine} Ends every “yes” the parent code gave on this device before it runs out.`
          }
          trailing={
            <Button size="sm" onClick={() => void lockFamilyGrants()}>
              Lock
            </Button>
          }
        />
      </SettingsGroup>

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
      footer={`${whereVoiceGoes(speechService)} SKYCOT never records or keeps the sound. Read-aloud uses a voice on this Mac and stays on; ${who} can switch it in Settings › Voice.`}
    >
      <ListRow
        leading={<StepBadge state={off ? "todo" : "ok"} icon={Mic} />}
        title="Voice typing (parent code)"
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
        <Banner tone="info">The parent code has been changed.</Banner>
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

function RenameForm({
  initial,
  onDone,
}: {
  readonly initial: string;
  readonly onDone: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    const result = await renameChild(name);
    setBusy(false);
    if (result.ok) onDone();
    else setFailure(result.message);
  };
  return (
    <div className="fm-family-inline">
      <TextField
        label="Child's first name"
        placeholder="Ava"
        autoComplete="off"
        autoFocus
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void save();
        }}
      />
      <p className="fm-help">Leave it empty for a greeting without a name.</p>
      {failure ? <Banner tone="warning">{failure}</Banner> : null}
      <div className="fm-family-inline__actions">
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function formatSince(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
