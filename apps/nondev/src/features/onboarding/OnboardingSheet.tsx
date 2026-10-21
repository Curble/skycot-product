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
  Palette,
  PartyPopper,
  ShieldCheck,
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
import { useActiveTheme } from "../../themes/store";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { List, ListExtra, ListRow } from "../../ui/ListRow";
import { Pill } from "../../ui/Pill";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Sheet } from "../../ui/Sheet";
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
import { readOnboardingState, writeOnboardingState } from "../settings/localPrefs";
import {
  PROVIDER_CATALOG,
  anyProviderReady,
  isProviderReady,
  providerForDriver,
} from "../settings/providerCatalog";
import { ProviderRow } from "../settings/ProviderRows";
import { plainFolderPath } from "../../app/folders";

type Step = "assistant" | "work" | "autonomy" | "look" | "done";
const STEPS: ReadonlyArray<Step> = ["assistant", "work", "autonomy", "look", "done"];

const STEP_META: Record<Step, { icon: LucideIcon; title: string; description: string }> = {
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
      "How the app looks is up to you; what it does never changes. Hover a card to try it on, click to keep it. You can change this any time in Settings → Appearance.",
  },
  done: {
    icon: PartyPopper,
    title: "You're set",
    description: "Everything here can be changed later in Settings.",
  },
};

/**
 * First-run onboarding as one macOS sheet with five short steps. Skippable at
 * every step; Settings → AI assistants → "Run the welcome steps again" reopens it.
 */
export function OnboardingSheet({
  environmentId,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("assistant");
  const index = STEPS.indexOf(step);
  const meta = STEP_META[step];
  const finish = (state: "done" | "skipped") => {
    writeOnboardingState(state);
    onClose();
    navigate(HOME_HREF);
  };
  // Escape and the backdrop cancel: they never turn an earlier "done" into
  // "skipped", and a first run that is cancelled simply stays skippable.
  const cancel = () => finish(readOnboardingState() === "done" ? "done" : "skipped");

  return (
    <Sheet
      open
      onClose={cancel}
      icon={meta.icon}
      iconTone={step === "autonomy" ? "orange" : "blue"}
      title={meta.title}
      description={meta.description}
      wide
      dismissOnBackdrop={false}
      actions={
        <>
          <span className="fm-steps" role="img" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
            {STEPS.map((entry, position) => (
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
            <Button onClick={() => setStep(STEPS[index - 1]!)}>Back</Button>
          ) : null}
          {step === "done" ? (
            <Button variant="primary" onClick={() => finish("done")}>
              Open {PRODUCT_NAME}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setStep(STEPS[index + 1]!)}>
              Continue
            </Button>
          )}
        </>
      }
    >
      {step === "assistant" ? <AssistantStep environmentId={environmentId} /> : null}
      {step === "work" ? <WorkStep environmentId={environmentId} /> : null}
      {step === "autonomy" ? <AutonomyStep environmentId={environmentId} /> : null}
      {step === "look" ? <LookStep /> : null}
      {step === "done" ? <DoneStep environmentId={environmentId} /> : null}
    </Sheet>
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

function LookStep() {
  const theme = useActiveTheme();
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

function DoneStep({ environmentId }: { readonly environmentId: EnvironmentId }) {
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
        <ListRow
          leading={<StepBadge state="done" />}
          title={autonomyLabel ?? "Ask me first"}
          subtitle="Your default autonomy. Change it in Settings → Autonomy & safety."
          trailing={
            <Pill tone="neutral" size="sm">
              Default
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
