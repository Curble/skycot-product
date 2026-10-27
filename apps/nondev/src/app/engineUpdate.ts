import { compareSemverVersions, parseSemver } from "@t3tools/shared/semver";

export function engineBuildIsNewer(
  engineBuild: string | null,
  clientBuild: string,
  engineStamp?: string | null,
  clientStamp?: string | null,
): boolean {
  return (
    engineBuild !== null &&
    parseSemver(engineBuild) !== null &&
    parseSemver(clientBuild) !== null &&
    (compareSemverVersions(engineBuild, clientBuild) > 0 ||
      (engineBuild === clientBuild &&
        engineStamp != null &&
        clientStamp != null &&
        engineStamp !== clientStamp))
  );
}

export function clientBundleStamp(assets: Iterable<string | null>): string | null {
  const hashed = [...assets]
    .filter((asset): asset is string => asset !== null && /-[\w.-]+\.(?:js|css)$/u.test(asset))
    .sort();
  return hashed.length > 0 ? hashed.join("|") : null;
}

export function canReloadForEngineUpdate(input: {
  readonly hasActiveRun: boolean;
  readonly hasUnsentText: boolean;
}): boolean {
  return !input.hasActiveRun && !input.hasUnsentText;
}
