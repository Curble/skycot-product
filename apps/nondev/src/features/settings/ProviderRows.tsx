import type {
  EnvironmentId,
  ExecutionEnvironmentPlatformOs,
  ServerProvider,
  ServerSettings,
} from "@t3tools/contracts";
import { ChevronDown, ExternalLink, LogOut, TerminalSquare } from "lucide-react";
import { useState } from "react";

import {
  resolveOnboardingProviderInstallCommand,
  resolveOnboardingProviderLoginCommand,
} from "~/onboarding/providerReadiness.logic";

import { ADVANCED_MODE_LABEL } from "../../brand";
import { isElectron } from "../../app/platform";
import { Button } from "../../ui/Button";
import { ListExtra, ListRow } from "../../ui/ListRow";
import { Pill } from "../../ui/Pill";
import { Sheet } from "../../ui/Sheet";
import { CopyButton } from "./CopyButton";
import {
  catalogEntryFor,
  flowFor,
  isProviderReady,
  isStillChecking,
  readiness,
  statusSentence,
} from "./providerCatalog";
import { useFamily } from "../family/FamilyProvider";
import { useProviderConnect } from "./useProviderConnect";

type PlatformOs = ExecutionEnvironmentPlatformOs;

/** Initials on the provider's colour, so rows read at a glance without logo assets. */
export function ProviderBadge({ driver }: { readonly driver: string }) {
  const entry = catalogEntryFor(driver);
  return (
    <span className={`fm-provider-badge fm-provider-badge--${driver}`} aria-hidden>
      {entry.brand.slice(0, 1)}
    </span>
  );
}

export function ProviderRow({
  environmentId,
  driver,
  provider,
  settings,
  os,
  showSignOut = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly driver: string;
  readonly provider: ServerProvider | undefined;
  readonly settings: ServerSettings | null;
  readonly os: PlatformOs;
  /** Settings shows sign-out; onboarding does not. */
  readonly showSignOut?: boolean;
}) {
  const entry = catalogEntryFor(driver);
  const connect = useProviderConnect(environmentId, driver, provider);
  // The assistants run on a parent's accounts and settings; the engine refuses changes to
  // them without the parent code while the Family profile is on.
  const family = useFamily();
  const asParent = (action: () => Promise<unknown>) => async () => {
    if (await family.requireParentCode("aiSettings")) await action();
  };
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const ready = isProviderReady(provider);
  const state = readiness(provider);
  const flow = flowFor(provider, driver);
  // Until the engine has answered, nothing is promised: no "Ready", no sign-in button. Codex
  // without a snapshot is the exception: its managed sign-in is what creates the snapshot.
  const checking = isStillChecking(provider, driver);

  const subtitle = connect.message ?? (entry.summary || statusSentence(provider));
  // The row says where it stands in words too, not only by its button: "Signed in as …",
  // "Installed. Needs you to sign in." (honest even when the summary leads).
  const detail = ready || connect.message || state === "signIn" ? statusSentence(provider) : null;

  const trailing = ready ? (
    <>
      <Pill tone="ok" size="sm">
        Ready
      </Pill>
      {showSignOut && connect.canSignOut ? (
        <Button size="sm" variant="quiet" icon={LogOut} onClick={() => setSignOutOpen(true)}>
          Sign out
        </Button>
      ) : null}
    </>
  ) : connect.status === "waiting" ? (
    <>
      <Button
        size="sm"
        variant="primary"
        icon={ExternalLink}
        onClick={() => void connect.openSignIn()}
      >
        Open sign-in page
      </Button>
      <Button size="sm" variant="quiet" onClick={() => void connect.cancel()}>
        Cancel
      </Button>
    </>
  ) : connect.status === "installing" ||
    connect.status === "finishing" ||
    connect.status === "preparing" ? (
    <Button size="sm" variant="quiet" onClick={() => void connect.cancel()}>
      Cancel
    </Button>
  ) : state === "disabled" ? (
    <>
      <Pill tone="neutral" size="sm">
        Off
      </Pill>
      <Button size="sm" onClick={() => void asParent(connect.enable)()} disabled={connect.busy}>
        Turn on
      </Button>
    </>
  ) : checking ? (
    <Pill tone="neutral" size="sm">
      Checking…
    </Pill>
  ) : flow === "instructions" ? (
    <Button
      size="sm"
      icon={ChevronDown}
      aria-expanded={instructionsOpen}
      onClick={() => setInstructionsOpen((value) => !value)}
    >
      {state === "install" ? "Show me how" : state === "signIn" ? "Sign in…" : "Show me how"}
    </Button>
  ) : (
    <Button
      size="sm"
      variant="primary"
      onClick={() => void asParent(connect.connect)()}
      disabled={connect.busy}
    >
      {state === "install" || (driver === "codex" && !provider?.installed)
        ? `Install & sign in`
        : `Sign in with ${entry.brand}`}
    </Button>
  );

  return (
    <>
      <ListRow
        leading={<ProviderBadge driver={driver} />}
        title={
          <>
            {entry.brand}
            <span className="fm-provider-runs"> · {entry.runs}</span>
          </>
        }
        subtitle={
          <>
            {subtitle}
            {detail && detail !== subtitle ? <> {detail}</> : null}
            {connect.deviceCode ? (
              <>
                {" "}
                Your code: <code className="fm-code">{connect.deviceCode}</code>
              </>
            ) : null}
          </>
        }
        trailing={trailing}
      />
      {instructionsOpen && flow === "instructions" ? (
        <ListExtra>
          <ProviderInstructions driver={driver} provider={provider} settings={settings} os={os} />
        </ListExtra>
      ) : null}
      <Sheet
        open={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        icon={LogOut}
        iconTone="orange"
        title={`Sign out of ${entry.brand}?`}
        description={`${entry.runs} will stop working in SKYCOT until you sign in again. Nothing in your projects changes.`}
        actions={
          <>
            <Button onClick={() => setSignOutOpen(false)}>Stay signed in</Button>
            <Button
              variant="destructive"
              filled
              onClick={() => {
                void asParent(connect.signOut)().then(() => setSignOutOpen(false));
              }}
            >
              Sign out
            </Button>
          </>
        }
      />
    </>
  );
}

/**
 * The two-step card for providers the engine cannot sign in for us (Claude
 * today): plain words, a command to copy, and never a terminal inside the app.
 */
export function ProviderInstructions({
  driver,
  provider,
  settings,
  os,
}: {
  readonly driver: string;
  readonly provider: ServerProvider | undefined;
  readonly settings: ServerSettings | null;
  readonly os: PlatformOs;
}) {
  const entry = catalogEntryFor(driver);
  const platform = os === "unknown" ? "darwin" : os;
  const installCommand =
    driver === "claudeAgent" || driver === "codex"
      ? resolveOnboardingProviderInstallCommand(driver, platform)
      : null;
  const loginCommand =
    provider && settings
      ? resolveOnboardingProviderLoginCommand(provider, settings, platform)
      : driver === "claudeAgent"
        ? "claude auth login"
        : null;
  const installed = provider?.installed === true;
  const openTerminal = () => {
    void window.desktopBridge?.openExternal("file:///System/Applications/Utilities/Terminal.app");
  };
  return (
    <div className="fm-howto" role="group" aria-label={`How to set up ${entry.brand}`}>
      <p className="fm-howto__lede">
        {entry.brand} doesn't let apps sign in for you yet, so this takes two short commands in
        Terminal (the Mac's built-in text window). Copy each one, paste it into Terminal and press
        Return. SKYCOT notices as soon as you're signed in.
      </p>
      <ol className="fm-howto__steps">
        {installCommand ? (
          <li className={`fm-howto__step${installed ? " fm-howto__step--done" : ""}`}>
            <span className="fm-howto__num" aria-hidden>
              {installed ? "✓" : "1"}
            </span>
            <div className="fm-howto__body">
              <b>{installed ? `${entry.runs} is installed.` : `Install ${entry.runs}.`}</b>
              {!installed ? (
                <>
                  <code className="fm-code fm-code--block">{installCommand}</code>
                  <CopyButton text={installCommand} />
                </>
              ) : null}
            </div>
          </li>
        ) : null}
        {loginCommand ? (
          <li className="fm-howto__step">
            <span className="fm-howto__num" aria-hidden>
              {installCommand ? (installed ? "1" : "2") : "1"}
            </span>
            <div className="fm-howto__body">
              <b>Sign in to your {entry.brand} account.</b>
              <span className="fm-help">
                This opens {entry.brand}'s website so you can sign in. Nothing is typed into SKYCOT.
              </span>
              <code className="fm-code fm-code--block">{loginCommand}</code>
              <CopyButton text={loginCommand} />
            </div>
          </li>
        ) : (
          <li className="fm-howto__step">
            <span className="fm-howto__num" aria-hidden>
              1
            </span>
            <div className="fm-howto__body">
              <b>Set this one up in {ADVANCED_MODE_LABEL}.</b>
              <span className="fm-help">
                {entry.runs} is a developer tool without a plain-language setup yet.
              </span>
            </div>
          </li>
        )}
      </ol>
      {isElectron ? (
        <div className="fm-howto__actions">
          <Button size="sm" icon={TerminalSquare} onClick={openTerminal}>
            Open Terminal
          </Button>
        </div>
      ) : null}
    </div>
  );
}
