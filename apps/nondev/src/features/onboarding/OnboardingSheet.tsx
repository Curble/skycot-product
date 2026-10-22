import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Folder,
  FolderOpen,
  FolderPlus,
  KeyRound,
  Palette,
  PartyPopper,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import { OpenFolderSheet } from "../../app/OpenFolderSheet";
import { ProjectAvatar } from "../../app/ProjectAvatar";
import { CREW_NAME, PRODUCT_NAME } from "../../brand";
import { HOME_HREF, navigate } from "../../router";
import { readAutonomy, writeAutonomy, writeLastProject } from "../../state/preferences";
import { environmentProjects, projectEnvironment } from "../../state/projects";
import { serverEnvironment } from "../../state/server";
import { ThemeGallery } from "../../themes/ThemeGallery";
import { hasChosenTheme, setActiveTheme, useActiveTheme, useShownTheme } from "../../themes/store";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { List, ListExtra, ListRow } from "../../ui/ListRow";
import { Pill } from "../../ui/Pill";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Sheet } from "../../ui/Sheet";
import { Mascot } from "../brand/Mascot";
import { mascotCopy } from "../brand/mascotCopy";
import { StepBadge } from "../../ui/StepBadge";
import { TextField } from "../../ui/TextField";
import { AUTONOMY_LEVELS, describeAutonomyLevel, hardRulesStatement } from "../../plain/autonomy";
import {
  AUTONOMY_OPTIONS,
  autonomyLevelOf,
  PLAIN_AUTONOMY_OPTIONS,
  plainAutonomyOrDefault,
  runtimeModeFor,
  type Autonomy,
} from "../compose/autonomy";
import { FAMILY_THEME_ID, useEnableFamilyWithDefaults } from "../family/applyDefaults";
import { familyCopy } from "../family/copy";
import { EMPTY_SETUP_DRAFT, setupReady, type FamilySetupDraft } from "../family/family";
import { useFamily } from "../family/FamilyProvider";
import { FamilySetupForm } from "../family/FamilySetupForm";
import { canContinue, onboardingSteps, type Audience, type OnboardingStep } from "./onboarding";
import { readOnboardingState, writeOnboardingState } from "../settings/localPrefs";
import {
  PROVIDER_CATALOG,
  anyProviderReady,
  isProviderReady,
  providerForDriver,
} from "../settings/providerCatalog";
import { ProviderRow } from "../settings/ProviderRows";
import { plainFolderPath } from "../../app/folders";

type Step = OnboardingStep;

const STEP_META: Record<Step, { icon: LucideIcon; title: string; description: string }> = {
  who: {
    icon: Users,
    title: "Who is this for?",
    description: `${mascotCopy.introduction} I can be set up for you, or for a child you look after. The ${familyCopy.title} adds guardrails and a parent code; it can be turned off later in Settings → Family.`,
  },
  family: {
    icon: KeyRound,
    title: `Set up the ${familyCopy.title}`,
    description:
      "A first name for the greeting, and a parent code of 4 to 6 digits. The code guards publishing, automations, the developer tools and turning the profile off.",
  },
  assistant: {
    icon: Bot,
    title: "Which AI do you already pay for?",
    description: `${PRODUCT_NAME} works with the AI plan you already have. Pick one and sign in on its own website — nothing to install by hand.`,
  },
  work: {
    icon: FolderOpen,
    title: "Where's your work?",
    description: `${CREW_NAME} only ever works inside a folder you choose. Open the one that holds just this website or app, or start something new.`,
  },
  autonomy: {
    icon: ShieldCheck,
    title: "How much should the AI do on its own?",
    description: "You can change this any time, for everything or for one conversation.",
  },
  look: {
    icon: Palette,
    title: "Pick a look",
    description:
      "How the app looks is up to you; what it does never changes. Hover a card to try it on, click to keep it: a clicked look stays even if you skip the rest. You can change this any time in Settings → Appearance.",
  },
  done: {
    icon: PartyPopper,
    title: "You're set",
    description: "Everything here can be changed later in Settings.",
  },
};

const FAMILY_AUTONOMY_DESCRIPTION = `Fixed by the ${familyCopy.title}: the assistant asks before every change and every command.`;

/**
 * First-run onboarding as one macOS sheet with short steps: who it is for,
 * (the Family set-up), assistant, folder, autonomy, look, done. Skippable at
 * every step; Settings → AI assistants → "Run the welcome steps again" reopens it.
 */
export function OnboardingSheet({
  environmentId,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
}) {
  const family = useFamily();
  // A profile that is already on cannot be undone from here (that needs the code in
  // Settings › Family), so the steps start on the child path with the set-up done.
  const [audience, setAudience] = useState<Audience | null>(family.enabled ? "child" : null);
  const [draft, setDraft] = useState<FamilySetupDraft>(EMPTY_SETUP_DRAFT);
  const [step, setStep] = useState<Step>("who");
  const [finishing, setFinishing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const enableFamily = useEnableFamilyWithDefaults(environmentId);
  const steps = onboardingSteps(audience, family.enabled);
  const index = Math.max(0, steps.indexOf(step));
  const meta = STEP_META[step];
  const childPath = audience === "child";
  const finish = (state: "done" | "skipped") => {
    writeOnboardingState(state);
    onClose();
    navigate(HOME_HREF);
  };
  // Escape and the backdrop cancel: they never turn an earlier "done" into
  // "skipped", and a first run that is cancelled simply stays skippable.
  const cancel = () => finish(readOnboardingState() === "done" ? "done" : "skipped");
  // Only the final button turns the Family profile on; skipping half-way leaves nothing locked.
  const complete = async () => {
    if (finishing) return;
    if (childPath && !family.enabled && setupReady(draft)) {
      setFinishing(true);
      setProblem(null);
      const failure = await enableFamily({ childName: draft.childName, code: draft.code });
      setFinishing(false);
      // The engine keeps the profile; if it could not, say so and stay here rather than
      // finish with a child path that protects nothing.
      if (failure !== null) {
        setProblem(failure);
        return;
      }
    }
    finish("done");
  };

  return (
    <Sheet
      open
      onClose={cancel}
      icon={meta.icon}
      {...(step === "who"
        ? { art: <Mascot pose="hello" size={64} /> }
        : step === "done"
          ? { art: <Mascot pose="yay" size={64} /> }
          : {})}
      iconTone={step === "autonomy" ? "orange" : step === "family" ? "grey" : "blue"}
      title={meta.title}
      description={
        step === "autonomy" && childPath ? FAMILY_AUTONOMY_DESCRIPTION : meta.description
      }
      wide
      dismissOnBackdrop={false}
      sober={step === "family"}
      actions={
        <>
          <span className="fm-steps" role="img" aria-label={`Step ${index + 1} of ${steps.length}`}>
            {steps.map((entry, position) => (
              <span
                key={entry}
                className={`fm-steps__dot${position <= index ? " fm-steps__dot--on" : ""}`}
              />
            ))}
          </span>
          {step !== "done" ? (
            <Button variant="quiet" onClick={() => finish("skipped")}>
              Skip for now
            </Button>
          ) : null}
          {index > 0 && step !== "done" ? (
            <Button onClick={() => setStep(steps[index - 1]!)}>Back</Button>
          ) : null}
          {step === "done" ? (
            <Button variant="primary" disabled={finishing} onClick={() => void complete()}>
              {finishing ? "Setting up…" : `Open ${PRODUCT_NAME}`}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!canContinue(step, audience, setupReady(draft))}
              onClick={() => setStep(steps[index + 1]!)}
            >
              Continue
            </Button>
          )}
        </>
      }
    >
      {step === "who" ? (
        <WhoStep audience={audience} onAudience={setAudience} familyEnabled={family.enabled} />
      ) : null}
      {step === "family" ? <FamilySetupForm draft={draft} onDraft={setDraft} autoFocus /> : null}
      {step === "assistant" ? <AssistantStep environmentId={environmentId} /> : null}
      {step === "work" ? <WorkStep environmentId={environmentId} /> : null}
      {step === "autonomy" ? (
        childPath ? (
          <FamilyAutonomyStep environmentId={environmentId} />
        ) : (
          <AutonomyStep environmentId={environmentId} />
        )
      ) : null}
      {step === "look" ? <LookStep preselectWorkshop={childPath} /> : null}
      {step === "done" && problem ? <Banner tone="warning">{problem}</Banner> : null}
      {step === "done" ? (
        <DoneStep
          environmentId={environmentId}
          {...(childPath
            ? { familyFor: family.profile.childName ?? (draft.childName.trim() || null) }
            : {})}
        />
      ) : null}
    </Sheet>
  );
}

function WhoStep({
  audience,
  onAudience,
  familyEnabled,
}: {
  readonly audience: Audience | null;
  readonly onAudience: (audience: Audience) => void;
  readonly familyEnabled: boolean;
}) {
  return (
    <div className="fm-onboarding">
      <div className="fm-who" role="radiogroup" aria-label="Who is this for?">
        <WhoCard
          icon={UserRound}
          title="Me"
          text="The usual set-up. Every autonomy level that keeps a safety promise, the developer tools a tap away."
          checked={audience === "me"}
          disabled={familyEnabled}
          onClick={() => onAudience("me")}
        />
        <WhoCard
          icon={Users}
          title="A child I look after"
          text={`${familyCopy.title}: SKYCOT's engine keeps the assistant asking first and child-friendly, and a parent code guards the internet, installs, publishing, automations and the developer tools. The Workshop look, unless you've picked another.`}
          checked={audience === "child"}
          onClick={() => onAudience("child")}
        />
      </div>
      {familyEnabled ? (
        <Banner tone="info">
          The {familyCopy.title} is on {audience === "child" ? "on this Mac" : ""}. To set{" "}
          {PRODUCT_NAME} up for yourself, turn it off first in Settings → Family (parent code).
        </Banner>
      ) : (
        <p className="fm-help">{familyCopy.honesty}</p>
      )}
    </div>
  );
}

function WhoCard({
  icon: Icon,
  title,
  text,
  checked,
  disabled = false,
  onClick,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly text: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className={`fm-who__card${checked ? " fm-who__card--on" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="fm-who__icon" aria-hidden>
        <Icon size={22} strokeWidth={1.7} />
      </span>
      <span className="fm-who__title">{title}</span>
      <span className="fm-who__text">{text}</span>
    </button>
  );
}

function FamilyAutonomyStep({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const policyEnforced = config?.skycotPolicy === true;
  return (
    <div className="fm-onboarding">
      <List label="Autonomy">
        <ListRow
          leading={<StepBadge state="ok" icon={ShieldCheck} />}
          title={`Always asks first (${familyCopy.title})`}
          subtitle={`${describeAutonomyLevel("askMeFirst", { policyEnforced })} ${AUTONOMY_LEVELS.askMeFirst.hint} The riskier levels are hidden while the profile is on.`}
          trailing={
            <Pill tone="neutral" size="sm">
              Fixed
            </Pill>
          }
        />
      </List>
      <p className="fm-help">{hardRulesStatement(policyEnforced, PRODUCT_NAME)}</p>
    </div>
  );
}

function AssistantStep({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const refresh = useAtomCommand(serverEnvironment.refreshProviders, { reportFailure: false });
  const [moreOpen, setMoreOpen] = useState(false);
  const os = config?.environment.platform.os ?? "darwin";

  useEffect(() => {
    void refresh({ environmentId, input: {} });
  }, [environmentId, refresh]);

  const primary = PROVIDER_CATALOG.filter((entry) => entry.primary);
  const others = PROVIDER_CATALOG.filter((entry) => !entry.primary);
  return (
    <div className="fm-onboarding">
      <List label="AI assistants">
        {primary.map((entry) => (
          <ProviderRow
            key={entry.driver}
            environmentId={environmentId}
            driver={entry.driver}
            provider={providerForDriver(providers, entry.driver)}
            settings={settings}
            os={os}
          />
        ))}
        <ListRow
          title="More…"
          subtitle="Cursor, Grok, OpenCode and other developer tools."
          trailing={
            moreOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />
          }
          expanded={moreOpen}
          onClick={() => setMoreOpen((value) => !value)}
        />
        {moreOpen
          ? others.map((entry) => (
              <ProviderRow
                key={entry.driver}
                environmentId={environmentId}
                driver={entry.driver}
                provider={providerForDriver(providers, entry.driver)}
                settings={settings}
                os={os}
              />
            ))
          : null}
      </List>
      <p className="fm-help">
        {anyProviderReady(providers)
          ? "At least one assistant is ready. You can connect more later in Settings."
          : "Green ticks appear as soon as an assistant is signed in. You can also do this later."}
      </p>
    </div>
  );
}

function WorkStep({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const projects = useAtomValue(environmentProjects.projectsAtom).filter(
    (project) => project.environmentId === environmentId,
  );
  const createNew = useAtomCommand(projectEnvironment.createNew, { reportFailure: false });
  const [folderOpen, setFolderOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const startNew = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setProblem(null);
    const outcome = await createNew({ environmentId, input: { name: trimmed } });
    setBusy(false);
    if (outcome._tag === "Failure") {
      const cause = squashAtomCommandFailure(outcome);
      setProblem(
        cause instanceof Error && /exist/i.test(cause.message)
          ? "There's already a project with that name."
          : "That project couldn't be created. Try another name.",
      );
      return;
    }
    writeLastProject({ environmentId, projectId: outcome.value.projectId as ProjectId });
    setNewOpen(false);
    setName("");
  };

  return (
    <div className="fm-onboarding">
      {projects.length > 0 ? (
        <List label="Your projects">
          {projects.map((project) => (
            <ListRow
              key={project.id}
              leading={<ProjectAvatar project={project} size="sm" />}
              title={project.title}
              subtitle={plainFolderPath(project.workspaceRoot)}
              trailing={<StepBadge state="done" label="Ready" />}
            />
          ))}
        </List>
      ) : null}
      <List label="Add work">
        <ListRow
          leading={<StepBadge state="todo" icon={Folder} />}
          title="Open a folder…"
          subtitle="A website or app that already exists on this Mac."
          chevron
          onClick={() => setFolderOpen(true)}
        />
        <ListRow
          leading={<StepBadge state="todo" icon={FolderPlus} />}
          title="Start something new"
          subtitle={`${CREW_NAME} makes a fresh folder for it.`}
          chevron
          expanded={newOpen}
          onClick={() => setNewOpen((value) => !value)}
        />
        {newOpen ? (
          <ListExtra>
            <div className="fm-onboarding__inline">
              <TextField
                label="What's it called?"
                placeholder="Little Fern Café website"
                value={name}
                autoFocus
                onChange={(event) => setName(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void startNew();
                }}
              />
              <div className="fm-onboarding__inline-actions">
                <Button size="sm" onClick={() => setNewOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void startNew()}
                  disabled={busy || name.trim().length === 0}
                >
                  {busy ? "Creating…" : "Create"}
                </Button>
              </div>
              {problem ? <Banner tone="warning">{problem}</Banner> : null}
            </div>
          </ListExtra>
        ) : null}
      </List>
      <OpenFolderSheet
        open={folderOpen}
        onClose={() => setFolderOpen(false)}
        environmentId={environmentId}
        onOpened={(projectId) =>
          writeLastProject({ environmentId, projectId: projectId as ProjectId })
        }
      />
    </div>
  );
}

function AutonomyStep({ environmentId }: { readonly environmentId: EnvironmentId }) {
  // Plain surfaces offer only the levels that keep a safety promise.
  const [autonomy, setAutonomy] = useState<Autonomy>(() => plainAutonomyOrDefault(readAutonomy()));
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const policyEnforced = config?.skycotPolicy === true;
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const level = autonomyLevelOf(autonomy);
  const info = AUTONOMY_LEVELS[level];

  const choose = (next: Autonomy) => {
    setAutonomy(next);
    writeAutonomy(next);
    const runtimeMode = runtimeModeFor(next, null);
    if (settings && settings.defaultRuntimeMode !== runtimeMode) {
      void updateSettings({ environmentId, input: { patch: { defaultRuntimeMode: runtimeMode } } });
    }
  };

  return (
    <div className="fm-onboarding">
      <SegmentedControl
        label="Autonomy"
        value={autonomy}
        onChange={choose}
        block
        wrap
        options={PLAIN_AUTONOMY_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          ...(option.tag ? { tag: option.tag } : {}),
        }))}
      />
      <p className="fm-help">
        <b>{info.label}.</b> {describeAutonomyLevel(level, { policyEnforced })} {info.hint}
      </p>
      {info.warning ? <Banner tone="warning">{info.warning}</Banner> : null}
      <p className="fm-help">{hardRulesStatement(policyEnforced, PRODUCT_NAME)}</p>
    </div>
  );
}

function LookStep({ preselectWorkshop }: { readonly preselectWorkshop: boolean }) {
  // Follows a hover/focus preview too, so the sentence names the look on screen.
  const theme = useShownTheme();
  // Workshop is everyone's default, so it is already ticked unless a look was picked (that
  // stands). The child path also pins it, for a browser whose default predates Workshop.
  useEffect(() => {
    if (preselectWorkshop && !hasChosenTheme()) setActiveTheme(FAMILY_THEME_ID);
  }, [preselectWorkshop]);
  return (
    <div className="fm-onboarding">
      <ThemeGallery compact showActions={false} label="Pick a look" />
      <p className="fm-help">
        <b>{theme.name}.</b> {theme.description ?? ""} Risky moments (approvals, undo, going live)
        stay plain in every look.
      </p>
    </div>
  );
}

function DoneStep({
  environmentId,
  familyFor,
}: {
  readonly environmentId: EnvironmentId;
  /** Undefined off the child path; the child's name (or null for none) on it. */
  readonly familyFor?: string | null;
}) {
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const projects = useAtomValue(environmentProjects.projectsAtom).filter(
    (project) => project.environmentId === environmentId,
  );
  const ready = (providers ?? []).filter(isProviderReady);
  const autonomy = readAutonomy();
  const autonomyLabel = AUTONOMY_OPTIONS.find((option) => option.value === autonomy)?.label;
  const theme = useActiveTheme();
  return (
    <div className="fm-onboarding">
      <List label="Summary">
        <ListRow
          leading={<StepBadge state={ready.length > 0 ? "done" : "warn"} />}
          title={
            ready.length > 0
              ? `${ready.map((provider) => provider.displayName ?? String(provider.driver)).join(", ")} ready`
              : "No assistant yet"
          }
          subtitle={
            ready.length > 0
              ? "New conversations use it automatically."
              : "Connect one in Settings → AI assistants when you're ready."
          }
        />
        <ListRow
          leading={<StepBadge state={projects.length > 0 ? "done" : "warn"} />}
          title={
            projects.length === 0
              ? "No project yet"
              : projects.length === 1
                ? `1 project: ${projects[0]!.title}`
                : `${projects.length} projects`
          }
          subtitle={
            projects.length > 0
              ? "Pick it in the sidebar to start a conversation."
              : "Open a folder from the sidebar any time."
          }
        />
        {familyFor !== undefined ? (
          <ListRow
            leading={<StepBadge state="done" />}
            title={familyFor ? `${familyCopy.title} for ${familyFor}` : `${familyCopy.title} on`}
            subtitle="Parent code set. Change it or turn the profile off in Settings → Family."
          />
        ) : null}
        <ListRow
          leading={<StepBadge state="done" />}
          title={familyFor !== undefined ? "Ask me first" : (autonomyLabel ?? "Ask me first")}
          subtitle={
            familyFor !== undefined
              ? `Fixed by the ${familyCopy.title}.`
              : "Your default autonomy. Change it in Settings → Autonomy & safety."
          }
          trailing={
            <Pill tone="neutral" size="sm">
              {familyFor !== undefined ? "Fixed" : "Default"}
            </Pill>
          }
        />
        <ListRow
          leading={<StepBadge state="done" />}
          title={`${theme.name} look`}
          subtitle="Your theme. Change it in Settings → Appearance."
        />
      </List>
    </div>
  );
}
