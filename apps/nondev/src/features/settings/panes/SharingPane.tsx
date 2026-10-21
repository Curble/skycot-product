import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Github, GitBranch } from "lucide-react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import { ADVANCED_MODE_LABEL } from "../../../brand";
import { AdvancedModeSheet } from "../../../app/AdvancedModeSheet";
import { Button } from "../../../ui/Button";
import { ListExtra, ListRow } from "../../../ui/ListRow";
import { Pill } from "../../../ui/Pill";
import { StepBadge } from "../../../ui/StepBadge";
import { CopyButton } from "../CopyButton";
import { SettingsGroup } from "../SettingsGroup";
import { gitHubStatusOf, gitInstalled, sourceControlEnvironment } from "../sourceControl";

const GITHUB_LOGIN_COMMAND = "gh auth login";

export function SharingPane({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const discovery = useAtomValue(sourceControlEnvironment.discovery({ environmentId, input: {} }));
  const result = Option.getOrNull(AsyncResult.value(discovery));
  const failed = discovery._tag === "Failure";
  const github = gitHubStatusOf(result);
  const git = gitInstalled(result);
  const [tokenSheetOpen, setTokenSheetOpen] = useState(false);

  return (
    <>
      <SettingsGroup
        title="GitHub"
        footer="GitHub is where kept versions go when you send them for review. SKYCOT reads the account your Mac is already signed in with; it doesn't store a password."
      >
        <ListRow
          leading={
            <StepBadge
              state={github?.signedIn ? "ok" : github === null ? "todo" : "warn"}
              icon={Github}
            />
          }
          title={
            github?.signedIn
              ? `Connected as ${github.account ?? "your account"}`
              : github?.installed
                ? "Not signed in"
                : github === null
                  ? failed
                    ? "Couldn't check"
                    : "Checking…"
                  : "GitHub tools aren't on this Mac"
          }
          subtitle={
            github?.signedIn
              ? github.host && github.host !== "github.com"
                ? `On ${github.host}.`
                : "Sending for review and publishing can use this account."
              : github?.installed
                ? "The GitHub command-line tool is installed but no one is signed in."
                : github === null
                  ? failed
                    ? "Your Mac didn't answer. Try again in a moment."
                    : "Asking your Mac about GitHub."
                  : `Install it with: ${github.installHint}`
          }
          trailing={
            github?.signedIn ? (
              <Pill tone="ok" size="sm">
                Connected
              </Pill>
            ) : null
          }
        />
        {github && !github.signedIn ? (
          <ListExtra>
            <div className="fm-howto fm-howto--flat">
              <p className="fm-howto__lede">
                SKYCOT can't sign you in to GitHub itself yet. Paste this into Terminal (the Mac's
                built-in text window), press Return and follow GitHub's questions. Come back here
                when it says you're logged in.
              </p>
              <code className="fm-code fm-code--block">{GITHUB_LOGIN_COMMAND}</code>
              <div className="fm-howto__actions">
                <CopyButton text={GITHUB_LOGIN_COMMAND} />
                <Button size="sm" variant="quiet" onClick={() => setTokenSheetOpen(true)}>
                  Paste a token in {ADVANCED_MODE_LABEL} instead…
                </Button>
              </div>
            </div>
          </ListExtra>
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        title="Versions"
        footer="Git is the tool that keeps every version of your project. SKYCOT uses it quietly; you only ever see Keep this version and Restore."
      >
        <ListRow
          leading={
            <StepBadge
              state={git === true ? "ok" : git === null ? "todo" : "warn"}
              icon={GitBranch}
            />
          }
          title={
            git === true
              ? "Version keeping is ready"
              : git === null
                ? "Checking…"
                : "Git isn't installed"
          }
          subtitle={
            git === true
              ? "Every kept version and restore point is stored on this Mac."
              : git === null
                ? "Asking your Mac."
                : "macOS offers to install it the first time it's needed."
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Reviewers">
        <ListRow
          title="Who reviews your work"
          subtitle="Your developer or a colleague appears under People once GitHub is connected."
          href="#/people"
          chevron
        />
      </SettingsGroup>
      <AdvancedModeSheet
        open={tokenSheetOpen}
        onClose={() => setTokenSheetOpen(false)}
        path="settings/source-control"
        reason="Pasting a GitHub token is done on its Source control page."
      />
    </>
  );
}
