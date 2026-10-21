# SEAM-MANIFEST.md — template

<!--
Copy this file to the repository root as `SEAM-MANIFEST.md` (the root file is the one the tooling
reads). Keep the table; prose around it is free-form. One row per upstream-owned file (or glob)
that this fork modifies. Every row is a promise: "we know we changed this, here is why, and here is
how to find our change again after a merge".

Checked by:   node nondev/scripts/check-seams.ts          (CI: .github/workflows/nondev-ci.yml)
Used by:      node nondev/scripts/upstream-sync.ts        (conflicts in a declared file -> take
              upstream's version, report "seam needs re-apply" with our diff)

Column rules
  id              short, stable, unique, kebab-case. Used in the marker and in reports.
  file            repo-relative path. Globs are allowed for binary/asset trees: `assets/prod/**`.
  lines           where in the file (line numbers or a region name). Informational only; it drifts.
  reason          one line: what the change does and why it cannot live in apps/nondev/** instead.
  marker          literal text that must exist in the file after every merge. Leave EMPTY to use
                  the convention `nondev-seam: <id>` (write it in the file as a comment in the
                  file's own syntax: `// nondev-seam: <id>` in TS/JS/JSONC, `# nondev-seam: <id>`
                  in YAML/shell). Write `none (JSON)` or `(binary)` when the file cannot carry a
                  comment; such rows are checked for being declared but not for the marker.
  upstream churn  how often upstream touches the file (commits per ~110 days, from the seam
                  report). Higher = more likely to conflict; keep those edits to one appended line.

Paths that never need a row (the fork owns them outright):
  apps/nondev/**  apps/server/src/skycot/**  packages/skycot-rules/**  nondev/**
  docs/{nondev,legal,security,qa,skycot-site}/**  .github/workflows/nondev-*.yml
  SEAM-MANIFEST.md  NOTICE  CONTRIBUTING-THEMES.md  (authoritative: OUR_PATH_GLOBS in nondev/scripts/lib.ts)
  pnpm-lock.yaml is generated and re-resolved by the sync; it is allowed to differ without a row.
-->

| id                   | file                         | lines                            | reason                                                                                                                  | marker                                 | upstream churn |
| -------------------- | ---------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------- |
| server-copy-dist     | `apps/server/scripts/cli.ts` | 88-96 (after the web copy)       | copy `apps/nondev/dist` into `dist/client/simple/` so `npx t3` and the desktop app serve our client beside the stock UI | `// nondev-seam: server-copy-dist`     | 12             |
| server-build-depends | `apps/server/vite.config.ts` | 62 (`dependsOn`)                 | build `@t3tools/nondev` before the server bundle so the copy above never races                                          | `// nondev-seam: server-build-depends` | 12             |
| server-devdep        | `apps/server/package.json`   | `devDependencies`                | `"@t3tools/nondev": "workspace:*"` so the dependency order above is real                                                | none (JSON)                            | 67             |
| knip-ignore          | `knip.jsonc`                 | `apps/server.ignoreDependencies` | stop knip flagging the workspace dep as unused                                                                          | `// nondev-seam: knip-ignore`          | 31             |
| dev-runner-filter    | `scripts/dev-runner.ts`      | `MODE_ARGS.dev`                  | add `--filter=@t3tools/nondev` so `vp run dev` also starts our client                                                   | `// nondev-seam: dev-runner-filter`    | 16             |

## How to add a seam

1. Make the smallest possible change (ideally one appended line) and put the marker comment on or
   directly above it.
2. Add the row above. `node nondev/scripts/check-seams.ts --working-tree --strict` must pass.
3. Say in the PR why the change cannot live under `apps/nondev/**`.

## How to retire a seam

Revert our change, delete the row, run the check. If upstream accepted the change (an upstream PR
made it configurable), note the upstream PR number in the commit message.
