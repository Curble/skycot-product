#!/usr/bin/env node
/**
 * check-workflows — lists every GitHub Actions workflow inherited from upstream that would run
 * in this repository without a repository guard (audit SEC-09).
 *
 *   node nondev/scripts/check-workflows.ts [--strict] [--allow ci.yml,windows-tests.yml] [--quiet]
 *
 * Upstream's workflows (release, publish, deploy, mobile builds, bots) run on our pushes and PRs
 * with GITHUB_TOKEN. Their secrets are absent here so publishing steps fail, but every nightly sync
 * can bring new or changed workflow definitions that execute before anyone reads them. A workflow
 * is "guarded" when a job or step condition compares `github.repository` or
 * `github.repository_owner`, so it does nothing outside pingdotgg/t3code. Our own
 * `nondev-*.yml` are ours and skipped; the allow-list names upstream workflows we want to keep
 * running unguarded (the test suites).
 *
 * The list is informational by default. The durable fix is to disable the unwanted workflows in
 * Settings → Actions (a human decision) — `--strict` is for the day that has been done, so a sync
 * that reintroduces an unguarded workflow fails CI.
 *
 * Exit codes: 0 ok, 1 (--strict only) at least one unguarded workflow, 2 could not run.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { repoRoot } from "./git.ts";

export const DEFAULT_WORKFLOW_ALLOWLIST = ["ci.yml", "windows-tests.yml"] as const;

export type WorkflowClass = "ours" | "guarded" | "allowlisted" | "unguarded";

export interface WorkflowCheck {
  name: string;
  kind: WorkflowClass;
  /** Triggers that hand a privileged token to code from a pull request or another run. */
  riskyTriggers: string[];
}

/** True when an `if:` style expression anywhere in the file compares the repository. */
export function hasRepositoryGuard(text: string): boolean {
  return /github\.(?:repository|repository_owner)\s*(?:==|!=)\s*['"]/u.test(text);
}

export function riskyTriggers(text: string): string[] {
  const found: string[] = [];
  for (const trigger of ["pull_request_target", "workflow_run"]) {
    if (new RegExp(`^\\s*${trigger}\\s*:`, "mu").test(text)) found.push(trigger);
  }
  return found;
}

export function classifyWorkflow(
  name: string,
  text: string,
  allowlist: readonly string[] = DEFAULT_WORKFLOW_ALLOWLIST,
): WorkflowCheck {
  const risky = riskyTriggers(text);
  if (/^nondev-.*\.ya?ml$/u.test(name)) return { name, kind: "ours", riskyTriggers: risky };
  if (hasRepositoryGuard(text)) return { name, kind: "guarded", riskyTriggers: risky };
  if (allowlist.includes(name)) return { name, kind: "allowlisted", riskyTriggers: risky };
  return { name, kind: "unguarded", riskyTriggers: risky };
}

export function classifyWorkflows(
  files: ReadonlyArray<{ name: string; text: string }>,
  allowlist: readonly string[] = DEFAULT_WORKFLOW_ALLOWLIST,
): WorkflowCheck[] {
  return files
    .map((f) => classifyWorkflow(f.name, f.text, allowlist))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function renderWorkflowCheck(checks: readonly WorkflowCheck[], strict: boolean): string {
  const unguarded = checks.filter((c) => c.kind === "unguarded");
  const L: string[] = [];
  L.push("## Workflow guard check");
  L.push(
    `- Workflows: ${checks.length} · ours: ${checks.filter((c) => c.kind === "ours").length} · guarded: ${checks.filter((c) => c.kind === "guarded").length} · allow-listed: ${checks.filter((c) => c.kind === "allowlisted").length} · **unguarded: ${unguarded.length}**`,
  );
  if (unguarded.length) {
    L.push(
      "",
      `### ${strict ? "✖" : "⚠"} Upstream workflows that run in this repository with no repository guard`,
      "",
    );
    for (const c of unguarded)
      L.push(
        `- \`${c.name}\`${c.riskyTriggers.length ? ` — uses ${c.riskyTriggers.map((t) => `\`${t}\``).join(", ")} (privileged token meets PR or cross-run input)` : ""}`,
      );
    L.push(
      "",
      "Disable the ones we do not need in Settings → Actions → General (or add a `github.repository == 'pingdotgg/t3code'` guard upstream).",
    );
  }
  L.push(
    "",
    unguarded.length === 0
      ? "**Result: OK** — every inherited workflow is guarded, allow-listed or ours."
      : strict
        ? "**Result: FAIL**"
        : "**Result: WARN** (informational; pass --strict to enforce)",
  );
  return L.join("\n");
}

function main(): void {
  const strict = process.argv.includes("--strict");
  const quiet = process.argv.includes("--quiet");
  const allowIndex = process.argv.indexOf("--allow");
  const allowlist =
    allowIndex >= 0 && process.argv[allowIndex + 1]
      ? process.argv[allowIndex + 1]!.split(",").map((s) => s.trim())
      : [...DEFAULT_WORKFLOW_ALLOWLIST];

  let root: string;
  try {
    root = repoRoot();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  const dir = NodePath.join(root, ".github/workflows");
  if (!NodeFS.existsSync(dir)) {
    console.error(`${dir} does not exist`);
    process.exit(2);
  }
  const files = NodeFS.readdirSync(dir)
    .filter((f) => /\.ya?ml$/u.test(f))
    .map((name) => ({ name, text: NodeFS.readFileSync(NodePath.join(dir, name), "utf8") }));
  const checks = classifyWorkflows(files, allowlist);
  const report = renderWorkflowCheck(checks, strict);
  if (!quiet) console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      NodeFS.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
    } catch {
      // summary is best-effort
    }
  }
  const fail = strict && checks.some((c) => c.kind === "unguarded");
  process.exit(fail ? 1 : 0);
}

if (process.argv[1]?.endsWith("check-workflows.ts")) main();
