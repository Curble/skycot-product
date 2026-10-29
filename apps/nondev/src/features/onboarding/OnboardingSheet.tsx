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
import { ADVANCED_MODE_LABEL, CREW_NAME, PRODUCT_NAME } from "../../brand";
import { HOME_HREF, navigate, settingsHref } from "../../router";
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
import { familyAgeTermsNote } from "../family/assistantAllowance";
import { handBack } from "../family/handoff";
import {
  childLabel,
  DEFAULT_READING_LEVEL,
  MAX_CHILDREN,
  type ReadingLevel,
} from "../family/children";
import { FamilySetupForm } from "../family/FamilySetupForm";
import {
  endGrownUpSession,
  grownUpSessionFor,
  readGrownUpSessionId,
  startGrownUpSession,
} from "../family/grownUpSession";
import {
  addChild,
  lockFamilyGrants,
  readFamilyView,
  tryParentCode,
  updateChild,
  refreshFamily,
  useFamilyView,
} from "../family/store";
import { markPickedThisWindow } from "../family-limits/FamilyLimitsHost";
import { rememberChild } from "../family-limits/idlePicker";
import { openChildPicker } from "../family-limits/FamilyLimitsHost";
import { chooseChild } from "../family-limits/store";
import { showToast } from "../../ui/Toast";
import { PictureStep } from "./PictureStep";
import {
  addSibling,
  canContinue,
  handOverLabel,
  markSetupOpen,
  onboardingProgress,
  firstChildNeedsLevel,
  firstChildSettings,
  onboardingSteps,
  projectsSummary,
  READING_BANDS,
  setupLanding,
  type Audience,
  type OnboardingStep,
} from "./onboarding";
import { WelcomePage } from "./WelcomePage";
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
      "A first name for the greeting, and a parent code of 4 to 6 digits. The code guards publishing, automations, Advanced mode and turning the profile off.",
  },
  children: {
    icon: Users,
    title: "Any other children?",
    description:
      "Add brothers and sisters now, so each has their own picture and reading level. You can change anything later in Settings → Family.",
  },
  picture: {
    icon: UserRound,
    title: "Pick a picture",
    description: "Everyone gets a picture to tap when SKYCOT opens and asks who's making today.",
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
    title: "How much should Sam do on its own?",
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

const FAMILY_AUTONOMY_DESCRIPTION = `Fixed by the ${familyCopy.title}: safe steps run by themselves, and anything risky waits for a grown-up.`;

/**
 * First-run onboarding as one macOS sheet with short steps: who it is for,
 * (the Family set-up), AI sign-in, folder, how much Sam does alone, look, done. Skippable at
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
  // Only the band (how simply Sam explains), never an age; saved once the profile is on.
  const [readingLevel, setReadingLevel] = useState<ReadingLevel>(DEFAULT_READING_LEVEL);
  // The steps are fixed when the sheet opens: turning the profile on half-way must not drop the
  // code screen from the list, or the progress dots shrink under the parent.
  const [familyAtOpen] = useState(family.enabled);
  const [finishing, setFinishing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [skipWarning, setSkipWarning] = useState(false);
  const enableFamily = useEnableFamilyWithDefaults(environmentId);
  const createProject = useAtomCommand(projectEnvironment.createNew, { reportFailure: false });
  const availableProjects = useAtomValue(environmentProjects.projectsAtom).filter(
    (project) => project.environmentId === environmentId,
  );
  const steps = onboardingSteps(audience, familyAtOpen);
  const index = Math.max(0, steps.indexOf(step));
  const progress = onboardingProgress(steps, step);
  const childPath = audience === "child";
  const firstChildName = family.profile.children[0]?.name ?? (draft.childName.trim() || null);
  const meta =
    step === "done" && childPath
      ? { ...STEP_META.done, title: handOverLabel(firstChildName) }
      : STEP_META[step];
  // While the steps are up, the shell must not restart the window (the parent code opens a
  // grown-up turn half-way through, and a restart here would end set-up at the code).
  useEffect(() => {
    markSetupOpen(true);
    return () => markSetupOpen(false);
  }, []);
  // The Mac's data remembers how the welcome ended. If that fails the welcome still closes (with
  // a note in the console) and simply shows again next time.
  const remember = async (state: "done" | "skipped") => {
    const ok = await family.setWelcome(state).catch(() => false);
    if (!ok) console.warn("SKYCOT could not save how the welcome ended.");
  };
  const finish = async (state: "done" | "skipped") => {
    // Running the steps again and skipping must not turn an earlier "done" into "skipped".
    await remember(state === "skipped" && family.profile.welcome === "done" ? "done" : state);
    onClose();
    navigate(HOME_HREF);
  };
  const linkPhone = async () => {
    await remember("done");
    onClose();
    navigate(settingsHref("family"));
  };
  const continueStep = async () => {
    if (step === "family" && childPath && !family.enabled) {
      setFinishing(true);
      setProblem(null);
      // The grown-up setting this up is the one using SKYCOT, so "Who's using SKYCOT?" waits.
      markPickedThisWindow();
      const failure = await enableFamily({
        childName: draft.childName,
        code: draft.code,
        child: firstChildSettings(readingLevel),
      });
      setFinishing(false);
      if (failure !== null) {
        setProblem(failure);
        return;
      }
      setSkipWarning(false);
      // The code just set opens the grown-up settings here, so the pictures save without asking
      // for it a second time, and this window is theirs until Done in the grown-up bar.
      const opened = await tryParentCode(draft.code, "settings", undefined, { quiet: true });
      // The engine's answer to the code carries the grants, not the people: read the profile
      // again so the child just set up is really there before anything is saved for them.
      if (opened.ok) await refreshFamily();
      const grownUp = readFamilyView().grownUps[0];
      const justSetUp = readFamilyView().children[0];
      // The child just set up is who Done hands back to.
      if (opened.ok && grownUp !== undefined)
        startGrownUpSession(grownUp.id, justSetUp?.id ?? null);
      // The engine took the band with the profile; only an older engine leaves it to save here.
      if (opened.ok && firstChildNeedsLevel(justSetUp, readingLevel)) {
        const saved =
          justSetUp === undefined
            ? ({ ok: false } as const)
            : await updateChild(justSetUp.id, { readingLevel });
        if (!saved.ok) {
          setProblem(
            "The reading level didn't save. Change it any time in Settings → Family → Edit.",
          );
        }
      }
      if (!hasChosenTheme()) setActiveTheme(FAMILY_THEME_ID);
      setStep("children");
      return;
    }
    setStep(steps[index + 1]!);
  };
  // Only the final button turns the Family profile on; skipping half-way leaves nothing locked.
  const complete = async (handOver = false) => {
    if (finishing) return;
    if (childPath && !family.enabled && setupReady(draft)) {
      setFinishing(true);
      setProblem(null);
      const failure = await enableFamily({
        childName: draft.childName,
        code: draft.code,
        child: firstChildSettings(readingLevel),
      });
      setFinishing(false);
      // The engine keeps the profile; if it could not, say so and stay here rather than
      // finish with a child path that protects nothing.
      if (failure !== null) {
        setProblem(failure);
        return;
      }
    }
    if (childPath) {
      const existing = availableProjects[0];
      if (existing === undefined) {
        const outcome = await createProject({ environmentId, input: { name: "My first project" } });
        if (outcome._tag === "Failure") {
          setProblem(
            "SKYCOT couldn't make your project folder. Try again, or open a folder later from the sidebar.",
          );
          return;
        }
        writeLastProject({ environmentId, projectId: outcome.value.projectId as ProjectId });
      } else {
        writeLastProject({ environmentId, projectId: existing.id as ProjectId });
      }
    }
    if (childPath) await landOnChild(!handOver);
    if (childPath && handOver) {
      // The same steps as "Done — hand back" in the grown-up menu. The first child is already
      // chosen above, so the picker stays shut and they land on their own Home.
      await remember("done");
      onClose();
      handBack(
        {
          lock: () => void lockFamilyGrants(),
          endSession: endGrownUpSession,
          openPicker: openChildPicker,
          goHome: () => navigate(HOME_HREF),
        },
        { picker: false },
      );
      return;
    }
    await finish("done");
  };
  // The child just set up is the one using SKYCOT here; the grown-up note appears only while
  // a grown-up session is really open (see setupLanding).
  const landOnChild = async (withNote: boolean) => {
    const view = readFamilyView();
    const landing = setupLanding({
      childId: view.children[0]?.id ?? null,
      currentChildId: view.currentChildId,
      grownUpSessionOpen: grownUpSessionFor(readGrownUpSessionId(), view, Date.now()) !== null,
    });
    if (landing.chooseChildId !== null) {
      const chosen = await chooseChild(landing.chooseChildId);
      if (chosen.ok) rememberChild(landing.chooseChildId, Date.now());
    }
    if (withNote && landing.note !== null) showToast(landing.note);
  };

  return (
    <WelcomePage
      art={<Mascot pose={step === "done" ? "yay" : "hello"} size={step === "who" ? 96 : 72} />}
      title={meta.title}
      description={
        step === "autonomy" && childPath ? FAMILY_AUTONOMY_DESCRIPTION : meta.description
      }
      sober={step === "family"}
      actions={
        <>
          {audience === null ? null : (
            <span
              className="fm-steps"
              role="img"
              aria-label={`Step ${progress.index + 1} of ${progress.steps.length}`}
            >
              {progress.steps.map((entry, position) => (
                <span
                  key={entry}
                  className={`fm-steps__dot${position === progress.index ? " fm-steps__dot--on" : ""}`}
                />
              ))}
            </span>
          )}
          {step !== "done" ? (
            <Button
              variant="quiet"
              onClick={() => {
                if (childPath && !family.enabled && !skipWarning) {
                  setSkipWarning(true);
                  return;
                }
                void finish("skipped");
              }}
            >
              {skipWarning ? "Skip without protection" : "Skip for now"}
            </Button>
          ) : null}
          {index > 0 && step !== "done" && !(steps[index - 1] === "family" && family.enabled) ? (
            <Button onClick={() => setStep(steps[index - 1]!)}>Back</Button>
          ) : null}
          {step === "done" && childPath ? (
            <>
              <Button variant="quiet" disabled={finishing} onClick={() => void complete(false)}>
                Stay in grown-up settings for now
              </Button>
              <Button variant="primary" disabled={finishing} onClick={() => void complete(true)}>
                {finishing ? "Setting up…" : handOverLabel(firstChildName)}
              </Button>
            </>
          ) : step === "done" ? (
            <Button variant="primary" disabled={finishing} onClick={() => void complete()}>
              {finishing ? "Setting up…" : `Open ${PRODUCT_NAME}`}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!canContinue(step, audience, setupReady(draft))}
              onClick={() => void continueStep()}
            >
              Continue
            </Button>
          )}
        </>
      }
    >
      {step === "who" ? (
        <WhoStep
          audience={audience}
          onAudience={setAudience}
          familyEnabled={family.enabled}
          readingLevel={readingLevel}
          onReadingLevel={setReadingLevel}
        />
      ) : null}
      {step === "family" ? (
        <>
          <FamilySetupForm draft={draft} onDraft={setDraft} autoFocus foldHonesty />
          <p className="fm-help">
            Bedtime and daily time limits start off. Set them in Settings → Family before your child
            uses SKYCOT.
          </p>
        </>
      ) : null}
      {step === "children" ? <ChildrenStep defaultLevel={readingLevel} /> : null}
      {step === "picture" ? <PictureStep /> : null}
      {step === "assistant" ? (
        <AssistantStep environmentId={environmentId} forChild={childPath} />
      ) : null}
      {step === "work" ? <WorkStep environmentId={environmentId} /> : null}
      {step === "autonomy" ? (
        childPath ? (
          <FamilyAutonomyStep environmentId={environmentId} />
        ) : (
          <AutonomyStep environmentId={environmentId} />
        )
      ) : null}
      {step === "look" ? <LookStep preselectWorkshop={childPath} /> : null}
      {problem ? <Banner tone="warning">{problem}</Banner> : null}
      {skipWarning ? (
        <Banner tone="warning">
          This child won't be protected by a parent code until you finish the Family set-up.
        </Banner>
      ) : null}
      {step === "done" ? (
        <DoneStep
          environmentId={environmentId}
          {...(childPath ? { onLinkPhone: () => void linkPhone() } : {})}
          {...(childPath
            ? { familyFor: family.profile.childName ?? (draft.childName.trim() || null) }
            : {})}
        />
      ) : null}
      {childPath ? <p className="fm-help">{familyCopy.privacyLine}</p> : null}
    </WelcomePage>
  );
}

function WhoStep({
  audience,
  onAudience,
  familyEnabled,
  readingLevel,
  onReadingLevel,
}: {
  readonly audience: Audience | null;
  readonly onAudience: (audience: Audience) => void;
  readonly familyEnabled: boolean;
  readonly readingLevel: ReadingLevel;
  readonly onReadingLevel: (level: ReadingLevel) => void;
}) {
  return (
    <div className="fm-onboarding">
      <div className="fm-who" role="radiogroup" aria-label="Who is this for?">
        <WhoCard
          icon={UserRound}
          title="Me"
          text={`The usual set-up, with every way of working that keeps a safety promise. ${ADVANCED_MODE_LABEL} (for grown-ups who code) is a tap away.`}
          checked={audience === "me"}
          disabled={familyEnabled}
          onClick={() => onAudience("me")}
        />
        <WhoCard
          icon={Users}
          title="A child I look after"
          text={`${familyCopy.title}: SKYCOT on this Mac keeps Sam asking first and child-friendly, and a parent code guards the internet, installs, publishing, automations and Advanced mode. The Workshop look, unless you've picked another.`}
          checked={audience === "child"}
          onClick={() => onAudience("child")}
        />
      </div>
      {audience === "child" && !familyEnabled ? (
        <div className="fm-help">
          <p>How simply should Sam explain things?</p>
          <SegmentedControl
            label="How simply Sam explains"
            options={READING_BANDS}
            value={readingLevel}
            onChange={onReadingLevel}
            wrap
          />
        </div>
      ) : null}
      {familyEnabled ? (
        <Banner tone="info">
          The {familyCopy.title} is on {audience === "child" ? "on this Mac" : ""}. To set{" "}
          {PRODUCT_NAME} up for yourself, turn it off first in Settings → Family (parent code).
        </Banner>
      ) : audience === "child" ? (
        <details className="fm-help">
          <summary>How this works</summary>
          <p>{familyCopy.honesty}</p>
        </details>
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

/** After the first child: add brothers and sisters one by one (name + reading band), then go on. */
function ChildrenStep({ defaultLevel }: { readonly defaultLevel: ReadingLevel }) {
  const { children } = useFamilyView();
  const [name, setName] = useState("");
  const [level, setLevel] = useState<ReadingLevel>(defaultLevel);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const full = children.length >= MAX_CHILDREN;

  const add = async () => {
    if (busy || name.trim().length === 0) return;
    setBusy(true);
    setProblem(null);
    const result = await addSibling(
      { name, readingLevel: level, childrenSoFar: children.length },
      addChild,
    );
    setBusy(false);
    if (result === null) return;
    if (!result.ok) {
      setProblem(
        "That child couldn't be added. Try again, or add them later in Settings → Family.",
      );
      return;
    }
    setName("");
  };

  return (
    <div className="fm-onboarding">
      <List label="Children">
        {children.map((child, index) => (
          <ListRow
            key={child.id}
            leading={<StepBadge state="done" />}
            title={childLabel(child, index)}
            subtitle={
              READING_BANDS.find((band) => band.value === child.readingLevel)?.label ?? undefined
            }
          />
        ))}
      </List>
      {full ? null : (
        <div className="fm-onboarding__inline">
          <TextField
            label="Add another child"
            placeholder="First name"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void add();
            }}
          />
          <p className="fm-help">How simply should Sam explain things for them?</p>
          <SegmentedControl
            label="How simply Sam explains"
            options={READING_BANDS}
            value={level}
            onChange={setLevel}
            wrap
          />
          <div className="fm-onboarding__inline-actions">
            <Button
              size="sm"
              variant="primary"
              disabled={busy || name.trim().length === 0}
              onClick={() => void add()}
            >
              {busy ? "Adding…" : "Add child"}
            </Button>
          </div>
        </div>
      )}
      {problem ? <Banner tone="warning">{problem}</Banner> : null}
      <p className="fm-help">
        Each child gets their own picture colour. Pictures, bedtimes and limits are in Settings →
        Family. Nobody else to add? Press Continue.
      </p>
    </div>
  );
}

function FamilyAutonomyStep({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const policyEnforced = config?.skycotPolicy === true;
  return (
    <div className="fm-onboarding">
      <List label="How much Sam does on its own">
        <ListRow
          leading={<StepBadge state="ok" icon={ShieldCheck} />}
          title={`Safe steps run by themselves (${familyCopy.title})`}
          subtitle={`${familyCopy.safeSteps}, and nothing changes until the plan is built. A parent can have a child asked before each step in Settings → Family. The riskier choices are hidden while the profile is on.`}
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

function AssistantStep({
  environmentId,
  forChild,
}: {
  readonly environmentId: EnvironmentId;
  /** Setting up the Family profile: the parent reads each service's age rules here. */
  readonly forChild: boolean;
}) {
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
      <List label="AI helpers">
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
          subtitle="Cursor, Grok, OpenCode and other tools for people who code."
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
          ? "At least one AI is ready. You can connect more later in Settings."
          : "To make something, choose an AI and sign in on its website; SKYCOT notices when you return."}
      </p>
      {forChild ? (
        <>
          <p className="fm-help">
            Each AI service has its own age rules, and the choice is yours. Any other AI needs your
            OK in Settings → Family.
          </p>
          <details className="fm-help">
            <summary>Read the terms</summary>
            <p>{familyAgeTermsNote()}</p>
          </details>
        </>
      ) : null}
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
        label="How much Sam does on its own"
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
  onLinkPhone,
}: {
  readonly environmentId: EnvironmentId;
  readonly onLinkPhone?: () => void;
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
              : "No AI connected yet"
          }
          subtitle={
            ready.length > 0
              ? "New conversations use it automatically."
              : "Connect one in Settings when you're ready."
          }
        />
        <ListRow
          leading={<StepBadge state={projects.length > 0 ? "done" : "warn"} />}
          title={projectsSummary(
            projects.map((project) => project.title),
            familyFor !== undefined,
          )}
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
            subtitle="Parent code set. Add another child, bedtimes and daily limits in Settings → Family."
          />
        ) : null}
        <ListRow
          leading={<StepBadge state="done" />}
          title={
            familyFor !== undefined
              ? "Safe steps run by themselves"
              : (autonomyLabel ?? "Ask me first")
          }
          subtitle={
            familyFor !== undefined
              ? `Anything risky waits for a grown-up. Fixed by the ${familyCopy.title}.`
              : "How much Sam does on its own. You can change it in Settings."
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
      {familyFor !== undefined && onLinkPhone ? (
        <List label="Next">
          <ListRow
            leading={<StepBadge state="todo" icon={Users} />}
            title="Link your phone now"
            subtitle="Open Family settings to link a grown-up's phone or Watch."
            trailing={
              <Button size="sm" onClick={onLinkPhone}>
                Link…
              </Button>
            }
          />
        </List>
      ) : null}
    </div>
  );
}
