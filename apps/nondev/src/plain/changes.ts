import type { OrchestrationV2CheckpointFileSummary } from "@t3tools/contracts";

import { parseUnifiedDiff as parseSharedDiff } from "@t3tools/skycot-rules/checkpoints";

import { changes as copy } from "./copy";

export type ChangeArea = "pages" | "styles" | "content" | "settings" | "behind the scenes";
export type ChangeOperation = "added" | "edited" | "deleted" | "renamed";

export interface FileChange {
  readonly path: string;
  readonly oldPath?: string;
  readonly operation: ChangeOperation;
  readonly additions: number;
  readonly deletions: number;
  readonly binary?: boolean;
}

export interface FileDescription {
  /** Plain noun phrase, e.g. "the booking page". Never a path. */
  readonly noun: string;
  readonly area: ChangeArea;
  readonly isConfigOrSecret: boolean;
  readonly isDependencyManifest: boolean;
  readonly isTest: boolean;
}

export interface FileChangeLine {
  readonly path: string;
  readonly area: ChangeArea;
  readonly line: string;
  readonly operation: ChangeOperation;
  readonly additions: number;
  readonly deletions: number;
}

export interface WhatChanged {
  readonly summary: string;
  readonly groups: ReadonlyArray<{
    readonly area: ChangeArea;
    readonly label: string;
    readonly files: ReadonlyArray<FileChangeLine>;
  }>;
  readonly counts: {
    readonly files: number;
    readonly added: number;
    readonly edited: number;
    readonly deleted: number;
    readonly renamed: number;
    readonly additions: number;
    readonly deletions: number;
  };
  readonly untouched: string;
  readonly flags: {
    readonly filesDeleted: ReadonlyArray<string>;
    readonly configOrSecretsTouched: ReadonlyArray<string>;
    readonly dependenciesChanged: ReadonlyArray<string>;
  };
  readonly warnings: ReadonlyArray<string>;
}

interface PathRule {
  readonly test: RegExp;
  readonly area: ChangeArea;
  /** Noun for the whole file; receives the humanised base name. */
  readonly noun?: (name: string) => string;
  readonly configOrSecret?: boolean;
  readonly dependencyManifest?: boolean;
  readonly isTest?: boolean;
}

/**
 * "the <name> <kind>", read the way a person would say it: a file the child called
 * "my-pet.html" is "your pet page" (never "the my pet page"), "pet-page.html" is "the pet
 * page" (never "the pet page page"), and "the-end.html" keeps one "the".
 */
export function named(name: string, kind: string): string {
  let rest = name.trim();
  let article = "the";
  const owned = /^(?:my|our|your|mine)(?:\s+|$)(.*)$/i.exec(rest);
  if (owned) {
    article = "your";
    rest = owned[1]!.trim();
  } else {
    rest = rest.replace(/^(?:the|a|an)\s+/i, "");
  }
  if (kind.length > 0) {
    const lower = rest.toLowerCase();
    if (lower === kind) rest = "";
    else if (lower.endsWith(` ${kind}`)) rest = rest.slice(0, -kind.length - 1).trim();
  }
  return [article, rest, kind].filter((part) => part.length > 0).join(" ");
}

// One ordered table drives every path heuristic in this layer. First match wins,
// so put the specific rows (lockfiles, env files) before the broad ones (any
// .ts file). Extend here, not in the callers.
const PATH_RULES: ReadonlyArray<PathRule> = [
  // Secrets and environment first: they must never fall through to "settings".
  {
    test: /(^|\/)\.env(\.|$)/i,
    area: "settings",
    noun: () => "the secret settings file",
    configOrSecret: true,
  },
  {
    test: /(secrets?|credentials?|\.pem|\.key|id_rsa)(\.|$)/i,
    area: "settings",
    noun: () => "a secrets file",
    configOrSecret: true,
  },
  // Dependency manifests and lockfiles.
  {
    test: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock|go\.sum)$/i,
    area: "behind the scenes",
    noun: () => "the exact add-on versions list",
    dependencyManifest: true,
  },
  {
    test: /(^|\/)package\.json$/i,
    area: "settings",
    noun: () => "the project's add-ons and scripts list",
    dependencyManifest: true,
    configOrSecret: true,
  },
  {
    test: /(^|\/)(requirements[^/]*\.txt|pyproject\.toml|Pipfile|Gemfile|go\.mod|Cargo\.toml|composer\.json)$/i,
    area: "settings",
    noun: () => "the project's add-ons list",
    dependencyManifest: true,
    configOrSecret: true,
  },
  // Project and tool configuration.
  {
    test: /(^|\/)(tsconfig[^/]*\.json|vite\.config\.[cm]?[jt]s|next\.config\.[cm]?[jt]s|tailwind\.config\.[cm]?[jt]s|postcss\.config\.[cm]?[jt]s|eslint\.config\.[cm]?[jt]s|\.eslintrc[^/]*|\.prettierrc[^/]*|babel\.config\.[cm]?[jt]s|webpack\.config\.[cm]?[jt]s|jest\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|playwright\.config\.[cm]?[jt]s)$/i,
    area: "settings",
    noun: (n) => named(n, "tool settings"),
    configOrSecret: true,
  },
  {
    test: /(^|\/)(Dockerfile|docker-compose[^/]*\.ya?ml|\.github\/workflows\/[^/]+|netlify\.toml|vercel\.json|fly\.toml|Procfile|\.gitignore|\.npmrc|\.nvmrc|\.editorconfig)$/i,
    area: "settings",
    noun: (n) => named(n, "setup file"),
    configOrSecret: true,
  },
  {
    test: /(^|\/)[^/]*\.(ya?ml|toml|ini|conf|cfg|properties)$/i,
    area: "settings",
    noun: (n) => named(n, "settings"),
    configOrSecret: true,
  },
  // Tests.
  {
    test: /(^|\/)(__tests__|tests?|spec|e2e|cypress|playwright)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|test_[^/]+\.py$/i,
    area: "behind the scenes",
    noun: (n) => `the checks for ${named(n, "").replace(/^the /, "")}`,
    isTest: true,
  },
  // Styles.
  {
    test: /\.(css|scss|sass|less|styl)$/i,
    area: "styles",
    noun: (n) =>
      /^(?:(?:my|our|your)\s+)?(global|globals|index|main|app|style|styles)$/i.test(n)
        ? "the site's overall styling"
        : named(n, "styling"),
  },
  {
    test: /(^|\/)(theme|tokens|colors|colours|typography)\.[cm]?[jt]sx?$/i,
    area: "styles",
    noun: (n) => named(n, "design settings"),
  },
  // Content.
  {
    test: /\.(md|mdx|markdown|txt|rtf)$/i,
    area: "content",
    noun: (n) =>
      /^readme$/i.test(n)
        ? "the README notes"
        : /^(changelog|history)$/i.test(n)
          ? "the change log"
          : /^license$/i.test(n)
            ? "the licence"
            : named(n, "text"),
  },
  {
    test: /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf|eot|pdf)$/i,
    area: "content",
    noun: (n) => named(n, "image or media file"),
  },
  {
    test: /(^|\/)(content|posts|blog|articles|copy|locales?|i18n|translations?)\//i,
    area: "content",
    noun: (n) => named(n, "content"),
  },
  { test: /\.(json|csv|xml)$/i, area: "content", noun: (n) => named(n, "data file") },
  // Pages: route folders and page-ish names.
  {
    test: /(^|\/)(pages|app|routes|views|screens)\/.*\.(tsx?|jsx?|vue|svelte|astro|html?|php|erb|hbs|ejs|njk)$/i,
    area: "pages",
    noun: (n) =>
      /^(index|page|home|route|layout|\+page|\[\.\.\.slug\]|\[slug\])$/i.test(n)
        ? "a page"
        : named(n, "page"),
  },
  {
    test: /\.(html?|vue|svelte|astro|erb|hbs|ejs|njk)$/i,
    area: "pages",
    // index.html is what a browser opens first: "the home page", not "the index page".
    noun: (n) => (/^(index|home|default)$/i.test(n) ? "the home page" : named(n, "page")),
  },
  {
    test: /(^|\/)(components?|ui|widgets|partials)\/.*\.(tsx|jsx)$/i,
    area: "pages",
    noun: (n) => named(n, "building block"),
  },
  // Code that is not a page.
  {
    test: /(^|\/)(api|server|backend|lib|utils?|helpers?|services?|hooks?|store|state|db|database|models?|schema|migrations?|prisma)\//i,
    area: "behind the scenes",
    noun: (n) => named(n, "behind-the-scenes code"),
  },
  {
    test: /\.(tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|cs|php|c|cc|cpp|h|hpp|sh|bash|zsh|ps1|sql|prisma|graphql|gql)$/i,
    area: "behind the scenes",
    noun: (n) => named(n, "code"),
  },
];

const FALLBACK_RULE: PathRule = {
  test: /.*/,
  area: "behind the scenes",
  noun: (n) => named(n, "file"),
};

// Prompt parsing lives in the shared rules package so the server policy reads prompts the
// same way the cards do.
export {
  filesFromPrompt,
  type PromptFile,
  type PromptFileOperation,
} from "@t3tools/skycot-rules/files";

export function humanizeFileName(path: string): string {
  const base = path.split(/[\\/]/).findLast((segment) => segment.length > 0) ?? path;
  const withoutExt = base.replace(/\.[^.]+$/, "").replace(/\.(test|spec|config|stories)$/i, "");
  const words = withoutExt
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\[|\]|\(|\)|\+|@/g, "")
    .trim()
    .toLowerCase();
  return words.length > 0 ? words : base.toLowerCase();
}

export function describeFile(path: string): FileDescription {
  const rule = PATH_RULES.find((candidate) => candidate.test.test(path)) ?? FALLBACK_RULE;
  const noun = (rule.noun ?? FALLBACK_RULE.noun!)(humanizeFileName(path));
  return {
    noun,
    area: rule.area,
    isConfigOrSecret: rule.configOrSecret === true,
    isDependencyManifest: rule.dependencyManifest === true,
    isTest: rule.isTest === true,
  };
}

/** Reads a unified diff into per-file changes; the engine's fridge and recap read it the same way. */
export function parseUnifiedDiff(diff: string): Array<FileChange> {
  return parseSharedDiff(diff);
}

/** Checkpoint summaries name the operation loosely ("A", "added", "modify"); normalise it. */
export function fromCheckpointFiles(
  files: ReadonlyArray<OrchestrationV2CheckpointFileSummary>,
): Array<FileChange> {
  return files.map((file) => ({
    path: file.path,
    operation: normalizeOperation(file.kind),
    additions: file.additions,
    deletions: file.deletions,
  }));
}

export function normalizeOperation(kind: string): ChangeOperation {
  const value = kind.trim().toLowerCase();
  if (/^(a|add|added|create|created|new)$/.test(value)) return "added";
  if (/^(d|del|delete|deleted|remove|removed)$/.test(value)) return "deleted";
  if (/^(r\d*|rename|renamed|move|moved)$/.test(value)) return "renamed";
  return "edited";
}

const AREA_ORDER: ReadonlyArray<ChangeArea> = [
  "pages",
  "styles",
  "content",
  "settings",
  "behind the scenes",
];

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function joinList(parts: ReadonlyArray<string>): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

export function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

export function describeFileChange(change: FileChange): FileChangeLine {
  const described = describeFile(change.path);
  const noun = described.noun;
  const size =
    change.binary === true
      ? ""
      : change.additions + change.deletions === 0
        ? ""
        : ` (+${change.additions} / −${change.deletions} lines)`;
  const verb =
    change.operation === "added"
      ? `Added ${noun}`
      : change.operation === "deleted"
        ? `Deleted ${noun}`
        : change.operation === "renamed"
          ? `Renamed ${change.oldPath ? describeFile(change.oldPath).noun : "a file"} to ${noun}`
          : `Edited ${noun}`;
  return {
    path: change.path,
    area: described.area,
    line: `${capitalize(verb)}${size}`,
    operation: change.operation,
    additions: change.additions,
    deletions: change.deletions,
  };
}

export function describeChanges(changes: ReadonlyArray<FileChange>): WhatChanged {
  const lines = changes.map(describeFileChange);
  const byArea = new Map<ChangeArea, Array<FileChangeLine>>();
  for (const line of lines) {
    const list = byArea.get(line.area) ?? [];
    list.push(line);
    byArea.set(line.area, list);
  }
  const groups = AREA_ORDER.filter((area) => byArea.has(area)).map((area) => ({
    area,
    label: copy.areas[area],
    files: byArea.get(area)!,
  }));

  const counts = {
    files: changes.length,
    added: changes.filter((c) => c.operation === "added").length,
    edited: changes.filter((c) => c.operation === "edited").length,
    deleted: changes.filter((c) => c.operation === "deleted").length,
    renamed: changes.filter((c) => c.operation === "renamed").length,
    additions: changes.reduce((sum, c) => sum + c.additions, 0),
    deletions: changes.reduce((sum, c) => sum + c.deletions, 0),
  };

  const flags = {
    filesDeleted: changes.filter((c) => c.operation === "deleted").map((c) => c.path),
    configOrSecretsTouched: changes
      .filter((c) => describeFile(c.path).isConfigOrSecret)
      .map((c) => c.path),
    dependenciesChanged: changes
      .filter((c) => describeFile(c.path).isDependencyManifest)
      .map((c) => c.path),
  };

  const warnings: Array<string> = [];
  if (flags.filesDeleted.length > 0)
    warnings.push(copy.flags.filesDeleted(flags.filesDeleted.length));
  if (flags.dependenciesChanged.length > 0) warnings.push(copy.flags.dependenciesChanged);
  if (flags.configOrSecretsTouched.some((path) => !flags.dependenciesChanged.includes(path))) {
    warnings.push(copy.flags.configOrSecretsTouched);
  }

  const summary =
    changes.length === 0
      ? copy.nothingChanged
      : `${capitalize(summaryVerb(counts))} ${pluralize(counts.files, "file")}: ${joinList(
          groups.map(
            (group) => `${group.files.length} ${areaNoun(group.area, group.files.length)}`,
          ),
        )}${counts.additions + counts.deletions > 0 ? ` (+${counts.additions} / −${counts.deletions} lines)` : ""}.`;

  return {
    summary,
    groups,
    counts,
    untouched: changes.length === 0 ? copy.nothingChanged : copy.untouched,
    flags,
    warnings,
  };
}

function summaryVerb(counts: WhatChanged["counts"]): string {
  if (counts.files === counts.added) return "added";
  if (counts.files === counts.deleted) return "deleted";
  return "changed";
}

function areaNoun(area: ChangeArea, count: number): string {
  switch (area) {
    case "pages":
      return count === 1 ? "page" : "pages";
    case "styles":
      return count === 1 ? "style file" : "style files";
    case "content":
      return count === 1 ? "content file" : "content files";
    case "settings":
      return count === 1 ? "settings file" : "settings files";
    case "behind the scenes":
      return count === 1 ? "behind-the-scenes file" : "behind-the-scenes files";
  }
}

/** Convenience for the "What changed" screen: straight from the `getTurnDiff` result. */
export function describeTurnDiff(diff: string): WhatChanged {
  return describeChanges(parseUnifiedDiff(diff));
}
