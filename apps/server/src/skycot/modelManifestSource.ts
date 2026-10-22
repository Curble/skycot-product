// Where the engine may refresh its list of AI models from.
//
// Upstream T3 Code refreshes `model-manifest.json` from its own GitHub repository every hour, so
// T3 Tools decides which models a running copy offers. SKYCOT must never fetch anything from T3
// Code's repository or sites at runtime (the same rule as its updates, docs/nondev/UPDATES.md),
// so the address has one source: `nondev/brand.json` → `modelManifest.url` → `nondev/brand/
// env.cjs` → `T3CODE_SKYCOT_MODEL_MANIFEST_URL`. It fails closed: no variable (a process started
// without the brand bootstrap), "none", anything that is not https, or an address of T3 Code's
// means the engine uses the manifest bundled with this build, which each upstream sync refreshes.

import { isT3ReleaseUrl } from "@t3tools/skycot-brand/updateFeed";

export const SKYCOT_MODEL_MANIFEST_URL_ENV = "T3CODE_SKYCOT_MODEL_MANIFEST_URL";
export const NO_MODEL_MANIFEST_URL = "none";

/** The remote manifest address, or null for "the bundled manifest only". */
export function remoteModelManifestUrl(value: string | undefined): string | null {
  if (value === undefined) return null;
  const url = value.trim();
  if (url === "" || url === NO_MODEL_MANIFEST_URL) return null;
  if (!/^https:\/\/[^\s/?#@]+\/[^\s]*$/iu.test(url)) return null;
  if (isT3ReleaseUrl(url) || /pingdotgg|t3code|t3\.codes|t3\.gg|t3\.chat/iu.test(url)) return null;
  return url;
}

/** The address this process may use, read when the manifest service starts. */
export const configuredModelManifestUrl = (): string | null =>
  remoteModelManifestUrl(process.env[SKYCOT_MODEL_MANIFEST_URL_ENV]);
