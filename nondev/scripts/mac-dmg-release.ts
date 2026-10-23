// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - A plain Node build step (no Effect), shared by the Effect build script.
/**
 * SKYCOT's signed Mac DMG: sign it, notarise it, staple it, then re-describe it.
 *
 * electron-builder notarises and staples the app, then wraps that app in a DMG that it leaves
 * unsigned (its `dmg.sign` default), so the download people open carries no signature and no
 * ticket: `spctl -t open --context context:primary-signature` rejects it ("no usable
 * signature") and only the app inside is checked, online. For a public download Apple's advice
 * is to sign and notarise the outermost container, so a SKYCOT release does that here, after
 * electron-builder and before its files leave the staging folder:
 *
 * 1. `codesign --sign "Developer ID Application: <CSC_NAME>" --timestamp` the DMG;
 * 2. `xcrun notarytool submit --keychain-profile <APPLE_KEYCHAIN_PROFILE> --wait`;
 * 3. `xcrun stapler staple` and `stapler validate`, then `spctl -t open` must accept it;
 * 4. the DMG's bytes changed, so its `.blockmap` is rebuilt with electron-builder's own
 *    `buildBlockMap`, and its `sha512` and `size` in the update feed file (`latest-mac.yml`)
 *    are replaced, written back with electron-builder's own YAML writer. The zip, which the
 *    updater installs from, is untouched.
 *
 * Without `APPLE_KEYCHAIN_PROFILE` the DMG is signed but not notarised, as electron-builder
 * skips the app's notarisation then. Notarising with an API key or Apple ID in the environment
 * (`APPLE_API_KEY*`, `APPLE_ID*`) is refused: the release uses the keychain profile only, so no
 * secret is ever in the build's environment (docs/nondev/RELEASE.md).
 *
 * Called from `scripts/build-desktop-artifact.ts` (seam `skycot-mac-dmg-notarize`) only for a
 * signed SKYCOT Mac DMG build (`resolveSkycotMacSigning` answered). Node only (not part of
 * `packages/skycot-brand`, which the browser client shares).
 */

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

const DEVELOPER_ID_PREFIX = "Developer ID Application: ";

export class SkycotDmgReleaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkycotDmgReleaseError";
  }
}

export interface SkycotDmgReleasePlan {
  /** What `codesign --sign` gets: a full certificate name or a SHA-1 hash. */
  readonly identity: string;
  /** notarytool's saved login; `null` = sign only, do not notarise. */
  readonly keychainProfile: string | null;
  /** A keychain other than the login one holding that profile (`APPLE_KEYCHAIN`). */
  readonly keychain: string | null;
}

/** `CSC_NAME` as electron-builder takes it ("Mark Hallam (TEAMID)"), as codesign needs it. */
export function codesignIdentityFromCscName(name: string): string {
  const trimmed = name.trim();
  if (/^[0-9A-Fa-f]{40}$/u.test(trimmed)) return trimmed;
  if (trimmed.startsWith(DEVELOPER_ID_PREFIX)) return trimmed;
  return `${DEVELOPER_ID_PREFIX}${trimmed}`;
}

/** What the DMG step will do, from the build's environment; throws when it cannot be done safely. */
export function resolveSkycotDmgRelease(
  env: Readonly<Record<string, string | undefined>>,
): SkycotDmgReleasePlan {
  const value = (name: string) => {
    const raw = env[name]?.trim();
    return raw === undefined || raw === "" ? null : raw;
  };
  const cscName = value("CSC_NAME");
  if (cscName === null) {
    throw new SkycotDmgReleaseError(
      'A signed SKYCOT DMG needs CSC_NAME (for example CSC_NAME="Mark Hallam (3F72LCWGG2)"): ' +
        "the Developer ID certificate the app is signed with signs the DMG too.",
    );
  }
  const keychainProfile = value("APPLE_KEYCHAIN_PROFILE");
  const secretNotarisation = [
    "APPLE_API_KEY",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
  ].filter((name) => value(name) !== null);
  if (secretNotarisation.length > 0) {
    throw new SkycotDmgReleaseError(
      `SKYCOT notarises with the keychain profile only (APPLE_KEYCHAIN_PROFILE), but ${secretNotarisation.join(", ")} ` +
        `${secretNotarisation.length === 1 ? "is" : "are"} set. Unset ${secretNotarisation.length === 1 ? "it" : "them"} and build again.`,
    );
  }
  return {
    identity: codesignIdentityFromCscName(cscName),
    keychainProfile,
    keychain: keychainProfile === null ? null : value("APPLE_KEYCHAIN"),
  };
}

export interface NotarySubmission {
  readonly id: string;
  readonly status: string;
  readonly message: string | null;
}

/** `xcrun notarytool submit --output-format json` → id and status ("Accepted", "Invalid", …). */
export function parseNotarySubmission(stdout: string): NotarySubmission {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new SkycotDmgReleaseError(`notarytool did not answer in JSON: ${stdout.slice(0, 400)}`);
  }
  const record = (parsed ?? {}) as Record<string, unknown>;
  if (typeof record["id"] !== "string" || typeof record["status"] !== "string") {
    throw new SkycotDmgReleaseError(
      `notarytool's answer has no id or status: ${stdout.slice(0, 400)}`,
    );
  }
  return {
    id: record["id"],
    status: record["status"],
    message: typeof record["message"] === "string" ? record["message"] : null,
  };
}

interface FeedFileEntry {
  url?: unknown;
  sha512?: unknown;
  size?: unknown;
  [key: string]: unknown;
}

/**
 * The feed file (`latest-mac.yml`, parsed) with one file's `sha512` and `size` replaced.
 * `false` when the feed does not list that file (nothing to change); throws if it is listed
 * as the file the updater installs (`path`), which must be the zip, never the DMG.
 */
export function replaceFeedFileDigest(
  info: Record<string, unknown>,
  fileName: string,
  digest: { readonly sha512: string; readonly size: number },
): boolean {
  if (info["path"] === fileName) {
    throw new SkycotDmgReleaseError(
      `${fileName} is the feed's install file (path); the updater must install from the zip.`,
    );
  }
  const files = Array.isArray(info["files"]) ? (info["files"] as FeedFileEntry[]) : [];
  const entries = files.filter((entry) => entry.url === fileName);
  if (entries.length === 0) return false;
  for (const entry of entries) {
    entry.sha512 = digest.sha512;
    entry.size = digest.size;
  }
  return true;
}

export interface SkycotDmgReleaseResult {
  readonly dmg: string;
  readonly notarySubmissionId: string | null;
  readonly sha512: string;
  readonly size: number;
  readonly feedFiles: readonly string[];
}

type Log = (line: string) => void;

function run(command: string, args: readonly string[], log: Log): string {
  log(`$ ${command} ${args.join(" ")}`);
  const result = NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error)
    throw new SkycotDmgReleaseError(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new SkycotDmgReleaseError(
      `${command} ${args[0] ?? ""} exited ${result.status}: ${(result.stderr || result.stdout || "").trim().slice(0, 2000)}`,
    );
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

interface ElectronBuilderHelpers {
  readonly buildBlockMap: (
    file: string,
    compression: "gzip",
    outFile: string,
  ) => Promise<{ readonly sha512: string; readonly size: number }>;
  readonly serializeToYaml: (object: unknown, skipInvalid?: boolean, noRefs?: boolean) => string;
  readonly loadYaml: (text: string) => unknown;
}

/** electron-builder's own blockmap and YAML code, from the copy `apps/desktop` builds with. */
function electronBuilderHelpers(repoRoot: string): ElectronBuilderHelpers {
  const fromDesktop = NodeModule.createRequire(
    NodePath.join(repoRoot, "apps/desktop/package.json"),
  );
  const fromBuilder = NodeModule.createRequire(
    fromDesktop.resolve("electron-builder/package.json"),
  );
  const blockmapPath = fromBuilder.resolve("app-builder-lib/out/targets/blockmap/blockmap");
  const fromAppBuilderLib = NodeModule.createRequire(blockmapPath);
  const builderUtilPath = fromAppBuilderLib.resolve("builder-util");
  const fromBuilderUtil = NodeModule.createRequire(builderUtilPath);
  return {
    buildBlockMap: fromAppBuilderLib(blockmapPath).buildBlockMap,
    serializeToYaml: fromAppBuilderLib(builderUtilPath).serializeToYaml,
    loadYaml: fromBuilderUtil(fromBuilderUtil.resolve("js-yaml")).load,
  };
}

/**
 * Signs, notarises and staples every `.dmg` in electron-builder's output folder, then rebuilds
 * its blockmap and its feed entries from the final bytes. Runs before the files are copied out.
 */
export async function finishSkycotMacDmgs(input: {
  readonly distDir: string;
  readonly repoRoot: string;
  readonly plan: SkycotDmgReleasePlan;
  readonly log?: Log;
}): Promise<readonly SkycotDmgReleaseResult[]> {
  const log: Log = input.log ?? ((line) => console.log(`[skycot-dmg] ${line}`));
  const entries: readonly string[] = NodeFS.readdirSync(input.distDir, "utf8");
  const dmgs = entries
    .filter((name) => name.endsWith(".dmg"))
    .map((name) => NodePath.join(input.distDir, name));
  if (dmgs.length === 0) throw new SkycotDmgReleaseError(`no .dmg in ${input.distDir}`);
  const feedFiles = entries
    .filter((name) => name.endsWith("-mac.yml"))
    .map((name) => NodePath.join(input.distDir, name));
  const helpers = electronBuilderHelpers(input.repoRoot);
  const results: SkycotDmgReleaseResult[] = [];

  for (const dmg of dmgs) {
    const name = NodePath.basename(dmg);
    run("codesign", ["--sign", input.plan.identity, "--timestamp", "--force", dmg], log);
    run("codesign", ["--verify", "--strict", "--verbose=2", dmg], log);

    let notarySubmissionId: string | null = null;
    if (input.plan.keychainProfile === null) {
      log(`${name}: signed; notarisation skipped (APPLE_KEYCHAIN_PROFILE is not set)`);
    } else {
      const keychainArgs = input.plan.keychain === null ? [] : ["--keychain", input.plan.keychain];
      const submitArgs = [
        "notarytool",
        "submit",
        dmg,
        "--keychain-profile",
        input.plan.keychainProfile,
        ...keychainArgs,
        "--wait",
        "--output-format",
        "json",
      ];
      log(`$ xcrun ${submitArgs.join(" ")}`);
      const submitted = NodeChildProcess.spawnSync("xcrun", submitArgs, {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });
      if (submitted.error) {
        throw new SkycotDmgReleaseError(`notarytool failed to start: ${submitted.error.message}`);
      }
      if (!(submitted.stdout ?? "").trim()) {
        throw new SkycotDmgReleaseError(
          `notarytool exited ${submitted.status} without an answer: ${(submitted.stderr ?? "").trim().slice(0, 2000)}`,
        );
      }
      const submission = parseNotarySubmission(submitted.stdout ?? "");
      notarySubmissionId = submission.id;
      log(`${name}: notarisation ${submission.id} ${submission.status}`);
      if (submission.status !== "Accepted") {
        const notaryLog = NodeChildProcess.spawnSync(
          "xcrun",
          [
            "notarytool",
            "log",
            submission.id,
            "--keychain-profile",
            input.plan.keychainProfile,
            ...keychainArgs,
          ],
          { encoding: "utf8" },
        );
        throw new SkycotDmgReleaseError(
          `Apple did not accept ${name} (submission ${submission.id}: ${submission.status}` +
            `${submission.message ? `, ${submission.message}` : ""}).\n${(notaryLog.stdout ?? "").slice(0, 4000)}`,
        );
      }
      run("xcrun", ["stapler", "staple", dmg], log);
      run("xcrun", ["stapler", "validate", dmg], log);
      const assessment = run(
        "spctl",
        ["--assess", "-vv", "--type", "open", "--context", "context:primary-signature", dmg],
        log,
      );
      if (!/source=Notarized Developer ID/u.test(assessment)) {
        throw new SkycotDmgReleaseError(
          `Gatekeeper did not accept ${name} as notarised:\n${assessment}`,
        );
      }
    }

    const blockmap = `${dmg}.blockmap`;
    const digest = await helpers.buildBlockMap(dmg, "gzip", blockmap);
    const stat = NodeFS.statSync(dmg);
    if (digest.size !== stat.size) {
      throw new SkycotDmgReleaseError(
        `blockmap size ${digest.size} is not ${name}'s ${stat.size} bytes`,
      );
    }
    log(`${name}: blockmap rebuilt (${digest.size} bytes, sha512 ${digest.sha512})`);

    const updatedFeeds: string[] = [];
    for (const feedFile of feedFiles) {
      const info = helpers.loadYaml(NodeFS.readFileSync(feedFile, "utf8"));
      if (info === null || typeof info !== "object") {
        throw new SkycotDmgReleaseError(`${feedFile} is not a feed file`);
      }
      if (replaceFeedFileDigest(info as Record<string, unknown>, name, digest)) {
        NodeFS.writeFileSync(feedFile, helpers.serializeToYaml(info, false, true));
        updatedFeeds.push(feedFile);
        log(`${NodePath.basename(feedFile)}: ${name} entry now matches the final bytes`);
      }
    }
    results.push({
      dmg,
      notarySubmissionId,
      sha512: digest.sha512,
      size: digest.size,
      feedFiles: updatedFeeds,
    });
  }
  return results;
}
