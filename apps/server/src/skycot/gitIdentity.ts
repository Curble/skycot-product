// A fallback Git identity for the commits SKYCOT makes on a family's project.
//
// First principles: Git refuses to commit without a name and an email. A child's Mac usually has
// neither (the first send on a fresh Mac failed in 3 seconds, beta 36 demo run, 29 October 2026),
// and a child must never be asked to set up Git. So for the one command only, SKYCOT passes
// `-c user.name=SKYCOT -c user.email=skycot@localhost`, and only for the field that is missing:
// someone who has an identity keeps it, and nothing is ever written to anyone's Git config.
import * as Effect from "effect/Effect";

import { isSkycotPolicyEnabled } from "./SkycotPolicy.ts";

export const FALLBACK_GIT_NAME = "SKYCOT";
export const FALLBACK_GIT_EMAIL = "skycot@localhost";

/** Runs `git <args>` in the project folder and says whether it exited 0 (with its output). */
export type RunGitProbe<E = never> = (
  args: ReadonlyArray<string>,
) => Effect.Effect<{ readonly exitCode: number; readonly stdout: string }, E>;

const has = (env: NodeJS.ProcessEnv, key: string) => (env[key] ?? "").trim().length > 0;

/**
 * The `-c` arguments to put before `commit` (empty when SKYCOT is off or an identity exists).
 * A missing probe answer counts as "missing" so the commit still gets an identity.
 */
export const fallbackIdentityArgs = <E>(
  probe: RunGitProbe<E>,
  env: NodeJS.ProcessEnv = process.env,
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    if (!isSkycotPolicyEnabled(env)) return [];
    const configured = (key: string) =>
      probe(["config", "--get", key]).pipe(
        Effect.map((r) => r.exitCode === 0 && r.stdout.trim().length > 0),
        Effect.orElseSucceed(() => false),
      );
    const args: Array<string> = [];
    const hasName =
      (has(env, "GIT_AUTHOR_NAME") && has(env, "GIT_COMMITTER_NAME")) ||
      (yield* configured("user.name"));
    const hasEmail =
      (has(env, "GIT_AUTHOR_EMAIL") && has(env, "GIT_COMMITTER_EMAIL")) ||
      has(env, "EMAIL") ||
      (yield* configured("user.email"));
    if (!hasName) args.push("-c", `user.name=${FALLBACK_GIT_NAME}`);
    if (!hasEmail) args.push("-c", `user.email=${FALLBACK_GIT_EMAIL}`);
    return args;
  });
