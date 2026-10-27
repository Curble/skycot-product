import { compareSemverVersions, parseSemver } from "@t3tools/shared/semver";

export function engineBuildIsNewer(engineBuild: string | null, clientBuild: string): boolean {
  return (
    engineBuild !== null &&
    parseSemver(engineBuild) !== null &&
    parseSemver(clientBuild) !== null &&
    compareSemverVersions(engineBuild, clientBuild) > 0
  );
}

export function canReloadForEngineUpdate(input: {
  readonly hasActiveRun: boolean;
  readonly hasUnsentText: boolean;
}): boolean {
  return !input.hasActiveRun && !input.hasUnsentText;
}
