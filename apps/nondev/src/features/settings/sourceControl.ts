import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS, type SourceControlDiscoveryResult } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../connection/runtime";

// `discovery({ environmentId, input: {} })` reports Git and the GitHub CLI on the
// Mac, including which account `gh` is signed in as. Read by Sharing & review
// and People; nothing here writes. The client-runtime's source-control atoms
// also carry clone/publish commands this client has no use for, so only the
// discovery query is built here.
export const sourceControlEnvironment = {
  discovery: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "nondev:source-control-discovery",
    tag: WS_METHODS.serverDiscoverSourceControl,
    staleTimeMs: 30_000,
  }),
};

export interface GitHubStatus {
  readonly installed: boolean;
  readonly signedIn: boolean;
  readonly account: string | null;
  readonly host: string | null;
  readonly installHint: string;
}

export function gitHubStatusOf(result: SourceControlDiscoveryResult | null): GitHubStatus | null {
  if (result === null) return null;
  const github = result.sourceControlProviders.find((entry) => entry.kind === "github");
  if (!github) return null;
  const active = github.auth.accounts?.find((entry) => entry.active && entry.authenticated);
  return {
    installed: github.status === "available",
    signedIn: github.auth.status === "authenticated",
    account:
      active?.account ?? (github.auth.account._tag === "Some" ? github.auth.account.value : null),
    host: active?.host ?? (github.auth.host._tag === "Some" ? github.auth.host.value : null),
    installHint: github.installHint,
  };
}

export function gitInstalled(result: SourceControlDiscoveryResult | null): boolean | null {
  if (result === null) return null;
  const git = result.versionControlSystems.find((entry) => entry.kind === "git");
  return git ? git.status === "available" : null;
}
