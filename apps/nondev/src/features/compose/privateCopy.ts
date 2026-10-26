// How a new conversation gets its private copy of the project. The engine only
// lets a thread undo and restore files when it works in its own Git worktree,
// so every conversation starts in one, named after the request. The pure parts
// live here; the composer runs the Git calls.
import type { VcsStatusResult } from "@t3tools/contracts";

export const PRIVATE_COPY_COPY = {
  /** Shown while `git init` + the first commit run on a folder that had no history. */
  settingUp: "Setting up version tracking…",
  makingCopy: "Making a private copy…",
  initExplainer: "SKYCOT will start tracking changes so you can undo.",
  firstVersion: (projectTitle: string) => `Start keeping versions of ${projectTitle}`,
  undoOff: "Undo is off for this conversation.",
  /** The confirmation before anything is written to a folder that was not tracked. */
  tracking: {
    title: "Start keeping versions of this folder?",
    body: (projectTitle: string) =>
      `“${projectTitle}” isn't tracked yet. SKYCOT will add a hidden folder called .git inside it and save a first version of everything in it, so every change can be undone. Nothing leaves this Mac.`,
    ignoreLabel: "Leave out passwords, keys and downloaded add-ons",
    ignoreHint:
      "Recommended. Adds a small list (.gitignore) so files like .env, *.key and node_modules are never saved in a version.",
    confirm: "Start tracking",
    cancel: "Not now",
  },
} as const;

export type FolderReadiness =
  | { readonly kind: "ready"; readonly baseBranch: string }
  | { readonly kind: "needs-init" }
  | { readonly kind: "no-branch" };

/** What a folder's Git status says about starting a private copy from it. */
export function folderReadiness(status: VcsStatusResult): FolderReadiness {
  if (!status.isRepo) return { kind: "needs-init" };
  if (status.refName === null) return { kind: "no-branch" };
  return { kind: "ready", baseBranch: status.refName };
}

/** Engine-created folders already have the user's choice baked into their ownership. */
export function shouldAskTrackingSheet(
  readiness: FolderReadiness,
  skycotCreatedFolder: boolean,
): boolean {
  return readiness.kind === "needs-init" && !skycotCreatedFolder;
}

/**
 * The ignore list written before the first version of a previously untracked
 * folder: secrets, keys, dependency caches and OS litter never belong in a
 * version, and a non-developer cannot be expected to know that.
 */
export const STARTER_GITIGNORE = [
  "# Added by SKYCOT when it started keeping versions of this folder.",
  "# Secrets and keys",
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "# Installed add-ons and build output (re-created automatically)",
  "node_modules/",
  "dist/",
  "build/",
  ".next/",
  ".cache/",
  "# System litter",
  ".DS_Store",
  "Thumbs.db",
  "# Local databases",
  "*.sqlite",
  "*.sqlite3",
  "*.db",
  "",
].join("\n");

/**
 * `skycot/christmas-menu-page-3fa2`: the request's first words, Git-safe,
 * plus a short token so two conversations about the same thing never collide.
 */
export function branchNameFor(request: string, token: string): string {
  const line = request.split(/\r?\n/).find((part) => part.trim().length > 0) ?? "";
  const words = line
    .toLowerCase()
    .replace(/['’"`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word))
    .slice(0, 5);
  const slug = (words.length > 0 ? words.join("-") : "conversation")
    .slice(0, 40)
    .replace(/-+$/, "");
  const suffix =
    token
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 4)
      .toLowerCase() || "0000";
  return `skycot/${slug}-${suffix}`;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "please",
  "can",
  "you",
  "it",
  "me",
  "my",
  "our",
  "add",
  "make",
]);

/** Git's reasons for refusing a worktree, in household English. Never a raw error string. */
export function plainPrivateCopyProblem(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/user\.name|user\.email|who you are|identity unknown|author identity/i.test(message))
    return "Git doesn't know your name and email yet, so SKYCOT can't save versions here.";
  if (
    /invalid reference|not a valid object|unborn|does not have any commits|no commits yet/i.test(
      message,
    )
  )
    return "This folder has no saved version to copy from yet.";
  if (/branch_already_exists|already exists/i.test(message))
    return "A private copy with this name already exists.";
  if (/scope|permission|unauthori/i.test(message))
    return "This connection isn't allowed to make a private copy.";
  return "SKYCOT couldn't make a private copy of the project.";
}
