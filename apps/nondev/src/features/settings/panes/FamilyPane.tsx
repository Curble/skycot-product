import type { EnvironmentId } from "@t3tools/contracts";
import { KeyRound, PencilLine, Power, Users, Wrench } from "lucide-react";
import { useState } from "react";

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
  setupProblem,
  strengthHint,
  type FamilySetupDraft,
} from "../../family/family";
import { FamilyHonestyBox } from "../../family/FamilySetupForm";
import { FamilySetupSheet } from "../../family/FamilySetupSheet";
import { useFamily } from "../../family/FamilyProvider";
import { ParentCodeEntry, useParentCodeEntry } from "../../family/ParentCodeEntry";
import { changeParentCode, disableFamily, renameChild } from "../../family/store";
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

function FamilyOnPane() {
  const { profile, requireParentCode } = useFamily();
  const [openRow, setOpenRow] = useState<Row>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const since = profile.createdAt ? formatSince(profile.createdAt) : null;

  const turnOff = async () => {
    const ok = await requireParentCode("disableFamily");
    if (ok) setConfirmOff(true);
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
          subtitle="Autonomy is fixed at “Ask me first” while the profile is on. The riskier modes are hidden."
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
          onClick={() => setOpenRow(openRow === "name" ? null : "name")}
        />
        {openRow === "name" ? (
          <ListExtra>
            <RenameForm initial={profile.childName ?? ""} onDone={() => setOpenRow(null)} />
          </ListExtra>
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        title="Developer tools"
        footer={`${ADVANCED_MODE_LABEL} is hidden from the sidebar and Settings while the profile is on. A parent can still open it from here.`}
      >
        <ListRow
          leading={<StepBadge state="todo" icon={Wrench} />}
          title={`Open ${ADVANCED_MODE_LABEL} (parent code)`}
          subtitle="The full developer interface, with no guardrails."
          trailing={
            <Button size="sm" onClick={() => setAdvancedOpen(true)}>
              Open…
            </Button>
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Turn off" footer={familyCopy.honesty}>
        <ListRow
          leading={<StepBadge state="warn" icon={Power} />}
          title={`Turn off the ${familyCopy.title}`}
          subtitle="Asks for the parent code, then confirms. The look and text size stay as they are; autonomy, Advanced mode and publishing open up again."
          trailing={
            <Button size="sm" variant="destructive" onClick={() => void turnOff()}>
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
        description="Every guardrail it added goes: the assistant can be set to do more on its own, Advanced mode comes back, and publishing no longer asks for a code. The child's name and the code are forgotten."
        sober
        dismissOnBackdrop={false}
        actions={
          <>
            <Button onClick={() => setConfirmOff(false)}>Keep it on</Button>
            <Button
              variant="destructive"
              filled
              onClick={() => {
                disableFamily();
                setConfirmOff(false);
              }}
            >
              Turn off
            </Button>
          </>
        }
      />
    </>
  );
}

function ChangeCodeForm({ onDone }: { readonly onDone: () => void }) {
  const [verified, setVerified] = useState(false);
  const entry = useParentCodeEntry(() => setVerified(true));
  const [draft, setDraft] = useState<FamilySetupDraft>({ childName: "", code: "", confirm: "" });
  const [saved, setSaved] = useState(false);
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

  if (!verified) {
    return (
      <div className="fm-family-inline">
        <ParentCodeEntry entry={entry} label="Current parent code" autoFocus />
        <div className="fm-family-inline__actions">
          <Button size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!entry.canSubmit}
            onClick={() => void entry.submit()}
          >
            {entry.busy ? "Checking…" : "Next"}
          </Button>
        </div>
      </div>
    );
  }

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
      <div className="fm-family-inline__actions">
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={problem !== null}
          onClick={() => {
            void changeParentCode(draft.code).then(() => setSaved(true));
          }}
        >
          Save new code
        </Button>
      </div>
    </div>
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
          if (event.key === "Enter") {
            renameChild(name);
            onDone();
          }
        }}
      />
      <p className="fm-help">Leave it empty for a greeting without a name.</p>
      <div className="fm-family-inline__actions">
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            renameChild(name);
            onDone();
          }}
        >
          Save
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
