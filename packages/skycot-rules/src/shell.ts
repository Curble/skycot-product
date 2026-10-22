// Shell-text primitives shared by the server policy and the plain client. They only
// read strings; nothing here touches the filesystem or a process. Moved from
// apps/nondev/src/plain/narration.ts so both sides split a command the same way.

/** `a && b | c; d` -> ["a", "b", "c", "d"]; quotes are respected. */
export function splitShellSegments(command: string): Array<string> {
  const segments: Array<string> = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!;
    if (quote) {
      current += ch;
      if (ch === quote && command[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    const pair = command.slice(i, i + 2);
    if (pair === "&&" || pair === "||") {
      segments.push(current);
      current = "";
      i += 1;
      continue;
    }
    // `>|` writes a file even with noclobber set; it is not a pipe.
    if (ch === "|" && command[i - 1] === ">") {
      current += ch;
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "\n") {
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}

/** Whitespace tokens with the outer quotes removed. */
export function tokenize(segment: string): Array<string> {
  const tokens = segment.match(/"(?:[^"\\]|\\.)*"|'[^']*'|\S+/g) ?? [];
  return tokens.map((token) => token.replace(/^["']|["']$/g, ""));
}

/** `for f in …`, `if …`, `done`: shell control words, not programs. */
const SHELL_CONTROL = new Set([
  "for",
  "if",
  "elif",
  "while",
  "until",
  "case",
  "select",
  "done",
  "fi",
  "esac",
  "}",
  ")",
  "{",
  "(",
]);
const SHELL_PREFIX = new Set(["do", "then", "else"]);

/**
 * Wrappers that run another program: the head word, the flags that take a value (so the
 * value is not mistaken for the program), and how many positionals to skip before the
 * program (`timeout 10 cmd`, `watch -n 1 cmd`).
 */
interface WrapperShape {
  readonly valueFlags: ReadonlySet<string>;
  readonly skipPositionals?: number;
  /** Flags whose value is itself a command line (`env -S "…"`, `script -c "…"`). */
  readonly shellStringFlags?: ReadonlySet<string>;
}

const NO_VALUE_FLAGS: ReadonlySet<string> = new Set();
const TRANSPARENT_WRAPPERS: ReadonlyMap<string, WrapperShape> = new Map<string, WrapperShape>([
  [
    "env",
    {
      valueFlags: new Set(["-u", "--unset", "-C", "--chdir"]),
      shellStringFlags: new Set(["-S", "--split-string"]),
    },
  ],
  ["time", { valueFlags: new Set(["-o", "--output", "-f", "--format"]) }],
  ["exec", { valueFlags: new Set(["-a"]) }],
  ["command", { valueFlags: NO_VALUE_FLAGS }],
  ["builtin", { valueFlags: NO_VALUE_FLAGS }],
  ["nice", { valueFlags: new Set(["-n", "--adjustment"]) }],
  ["ionice", { valueFlags: new Set(["-c", "-n", "-p", "-P", "-u"]) }],
  ["nohup", { valueFlags: NO_VALUE_FLAGS }],
  ["stdbuf", { valueFlags: new Set(["-i", "-o", "-e", "--input", "--output", "--error"]) }],
  ["caffeinate", { valueFlags: new Set(["-t", "-w"]) }],
  [
    "timeout",
    { valueFlags: new Set(["-s", "--signal", "-k", "--kill-after"]), skipPositionals: 1 },
  ],
  ["watch", { valueFlags: new Set(["-n", "--interval", "-d", "--differences"]) }],
  [
    "xargs",
    {
      valueFlags: new Set([
        "-n",
        "-I",
        "-i",
        "-L",
        "-l",
        "-P",
        "-s",
        "-d",
        "-a",
        "-E",
        "-J",
        "-R",
        "-S",
        "--max-args",
        "--replace",
        "--max-lines",
        "--max-procs",
        "--max-chars",
        "--delimiter",
        "--arg-file",
        "--eof",
      ]),
    },
  ],
  [
    "sudo",
    {
      valueFlags: new Set([
        "-u",
        "--user",
        "-g",
        "--group",
        "-C",
        "--close-from",
        "-h",
        "--host",
        "-p",
        "--prompt",
        "-r",
        "--role",
        "-t",
        "--type",
        "-U",
        "--other-user",
        "-D",
        "--chdir",
        "-R",
        "--chroot",
        "-T",
        "--command-timeout",
      ]),
    },
  ],
  ["doas", { valueFlags: new Set(["-u", "-C"]) }],
  ["chroot", { valueFlags: new Set(["--userspec", "--groups"]), skipPositionals: 1 }],
  // Linux `script -c "cmd" log`; macOS `script -q log cmd` (the log file comes first).
  [
    "script",
    {
      valueFlags: new Set(["-t", "-T", "-F", "-E", "--timing", "--log-out"]),
      shellStringFlags: new Set(["-c", "--command"]),
      skipPositionals: 1,
    },
  ],
  ["unbuffer", { valueFlags: NO_VALUE_FLAGS }],
]);

/**
 * Package runners: `npx vercel --prod` runs the `vercel` program, so the rules must judge
 * `vercel`, not `npx`. `-c`/`--call` hands a shell string over, which is judged as such.
 */
const RUNNER_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "-p",
  "--package",
  "-c",
  "--call",
  "--shell",
  "--node-options",
  "--npm",
  "--userconfig",
  "--loglevel",
  "--prefix",
  "-w",
  "--workspace",
  "--cwd",
  "--filter",
  "-C",
  "--dir",
  "--reporter",
  "--cache",
  "--pkg",
  "--quiet-flag",
]);
const SHELL_STRING_FLAGS: ReadonlySet<string> = new Set(["-c", "--call"]);

/** `npx`, `pnpm dlx`, `yarn exec`, `bun x`, `deno run npm:x`: [head, optional sub-command]. */
function runnerPrefixLength(tokens: ReadonlyArray<string>): number {
  const head = programBaseName(tokens[0] ?? "").toLowerCase();
  if (head === "npx" || head === "pnpx" || head === "bunx") return 1;
  if (!["npm", "pnpm", "yarn", "bun", "deno"].includes(head)) return 0;
  // `pnpm --filter web exec vercel`: the manager's own flags may come before the sub-command.
  const afterFlags = stripValuedFlags(tokens.slice(1), RUNNER_VALUE_FLAGS).rest;
  const sub = (afterFlags[0] ?? "").toLowerCase();
  const prefix = tokens.length - afterFlags.length + 1;
  if (head === "npm" && (sub === "exec" || sub === "x")) return prefix;
  if (head === "pnpm" && (sub === "dlx" || sub === "exec")) return prefix;
  if (head === "yarn" && (sub === "dlx" || sub === "exec")) return prefix;
  if (head === "bun" && sub === "x") return prefix;
  if (head === "deno" && sub === "run") return prefix;
  return 0;
}

/** `vercel@latest` -> `vercel`, `@netlify/cli` -> `netlify`, `npm:firebase-tools` -> `firebase`. */
export function packageBinaryName(spec: string): string {
  let name = spec.replace(/^(npm|jsr):/, "");
  // Trailing version: everything after an `@` that is not the scope marker.
  name = name.replace(/(^@?[^@]+)@[^@]*$/, "$1");
  if (name.startsWith("@")) {
    const [scope = "", rest = ""] = name.slice(1).split("/");
    name = rest === "" || /^(cli|cli-tools?|tools?)$/.test(rest) ? scope : rest;
  }
  return name.replace(/-(cli|tools|tool)$/, "");
}

function stripValuedFlags(
  tokens: ReadonlyArray<string>,
  valueFlags: ReadonlySet<string>,
  skipPositionals = 0,
  shellStringFlags: ReadonlySet<string> = NO_VALUE_FLAGS,
): { readonly rest: Array<string>; readonly shellString: string | null } {
  let index = 0;
  let positionalsToSkip = skipPositionals;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token === "--") {
      index += 1;
      break;
    }
    if (token.startsWith("-") && token.length > 1) {
      const [flag] = token.split("=", 1);
      if (shellStringFlags.has(flag!)) {
        const script = token.includes("=")
          ? token.slice(token.indexOf("=") + 1)
          : tokens[index + 1];
        return { rest: [], shellString: script ?? null };
      }
      index += valueFlags.has(flag!) && !token.includes("=") ? 2 : 1;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token) && valueFlags !== RUNNER_VALUE_FLAGS) {
      // `env FOO=1 cmd`, `sudo FOO=1 cmd`
      index += 1;
      continue;
    }
    if (positionalsToSkip > 0) {
      positionalsToSkip -= 1;
      index += 1;
      continue;
    }
    break;
  }
  return { rest: tokens.slice(index), shellString: null };
}

/** The program a package manager would run for `yarn vercel` / `pnpm vercel --prod`. */
function bareScriptRunner(
  tokens: ReadonlyArray<string>,
  bins: ReadonlySet<string> | undefined,
): Array<string> | null {
  if (!bins) return null;
  const head = programBaseName(tokens[0] ?? "").toLowerCase();
  if (head !== "yarn" && head !== "pnpm" && head !== "npm" && head !== "bun") return null;
  const { rest } = stripValuedFlags(tokens.slice(1), RUNNER_VALUE_FLAGS);
  // `npm run vercel`, `yarn run vercel`: the script name may be the binary.
  const direct =
    rest[0]?.toLowerCase() === "run" || rest[0]?.toLowerCase() === "run-script"
      ? rest.slice(1)
      : head === "npm"
        ? null
        : rest;
  if (direct === null || direct.length === 0) return null;
  const bin = packageBinaryName(direct[0]!);
  return bins.has(bin) ? [bin, ...direct.slice(1)] : null;
}

export interface ProgramTokensOptions {
  /**
   * Binaries a package manager runs straight from `node_modules/.bin` (`yarn vercel`,
   * `pnpm wrangler deploy`). Only these are unwrapped, so `yarn build` stays a script.
   */
  readonly bins?: ReadonlySet<string> | undefined;
}

/**
 * Drops `cd x`-style wrappers, env assignments, `sudo`, `time`, `exec`, `xargs`, package
 * runners (`npx`, `pnpm dlx`, `bunx`, `deno run npm:`) and `bash -c "…"` layers to find the
 * real program and its arguments. The program returned is the one that would do the work,
 * so a rule keyed on `vercel` sees `npx vercel --prod` and `/usr/local/bin/vercel` alike.
 */
export function programTokens(segment: string, options: ProgramTokensOptions = {}): Array<string> {
  let tokens = tokenize(segment);
  for (let guard = 0; guard < 16 && tokens.length > 0; guard += 1) {
    const head = tokens[0]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) {
      tokens = tokens.slice(1);
      continue;
    }
    if (SHELL_PREFIX.has(head)) {
      tokens = tokens.slice(1);
      continue;
    }
    const base = programBaseName(head).toLowerCase();
    const wrapper = TRANSPARENT_WRAPPERS.get(base);
    if (wrapper) {
      // `command -v x` looks a program up; it does not run it.
      if (base === "command" && tokens.some((t, i) => i > 0 && /^-[vV]$/.test(t))) return tokens;
      const { rest, shellString } = stripValuedFlags(
        tokens.slice(1),
        wrapper.valueFlags,
        wrapper.skipPositionals,
        wrapper.shellStringFlags,
      );
      if (shellString !== null) return programTokens(shellString, options);
      tokens = rest;
      continue;
    }
    const runner = runnerPrefixLength(tokens);
    if (runner > 0) {
      const { rest, shellString } = stripValuedFlags(
        tokens.slice(runner),
        RUNNER_VALUE_FLAGS,
        0,
        SHELL_STRING_FLAGS,
      );
      if (shellString !== null) return programTokens(shellString, options);
      if (rest.length === 0) return tokens;
      // `deno run -A npm:vercel`: permission flags are already gone; the spec names the bin.
      tokens = [packageBinaryName(rest[0]!), ...rest.slice(1)];
      continue;
    }
    const viaManager = bareScriptRunner(tokens, options.bins);
    if (viaManager) {
      tokens = viaManager;
      continue;
    }
    // `node node_modules/vercel/dist/index.js --prod`, `node_modules/.bin/vercel`
    if ((base === "node" || base === "bun" || base === "deno") && tokens[1]) {
      const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(tokens[1]);
      if (match) {
        tokens = [packageBinaryName(match[1]!), ...tokens.slice(2)];
        continue;
      }
    }
    break;
  }
  if (tokens.length > 0 && SHELL_CONTROL.has(tokens[0]!)) return [];
  if (
    tokens.length >= 3 &&
    /^(ba|z|da|k)?sh$/.test(programBaseName(tokens[0]!)) &&
    /^-[a-z]*c[a-z]*$/.test(tokens[1]!)
  ) {
    return programTokens(tokens.slice(2).join(" "), options);
  }
  return tokens;
}

/**
 * `sh -c "a && b"` as a segment: the script inside, so every command in it is judged, or
 * null when the segment is not a shell-with-script.
 */
export function innerShellScript(segment: string): string | null {
  const tokens = tokenize(segment);
  let index = 0;
  while (index < tokens.length) {
    const head = tokens[index]!;
    const base = programBaseName(head).toLowerCase();
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head) || SHELL_PREFIX.has(head)) index += 1;
    else if (TRANSPARENT_WRAPPERS.has(base) && base !== "command") {
      const wrapper = TRANSPARENT_WRAPPERS.get(base)!;
      const { rest, shellString } = stripValuedFlags(
        tokens.slice(index + 1),
        wrapper.valueFlags,
        wrapper.skipPositionals,
        wrapper.shellStringFlags,
      );
      if (shellString !== null) return shellString;
      index = tokens.length - rest.length;
    } else {
      // `npx -c "a && b"`, `npm exec --call="…"`: the runner hands a whole script over.
      const runner = runnerPrefixLength(tokens.slice(index));
      if (runner === 0) break;
      const { shellString } = stripValuedFlags(
        tokens.slice(index + runner),
        RUNNER_VALUE_FLAGS,
        0,
        SHELL_STRING_FLAGS,
      );
      return shellString;
    }
  }
  const program = tokens[index];
  const flag = tokens[index + 1];
  if (!program || !flag) return null;
  if (!/^(ba|z|da|k)?sh$/.test(programBaseName(program)) || !/^-[a-z]*c[a-z]*$/.test(flag)) {
    return null;
  }
  // `-c` takes the next word as the script; shellUnquote already ran via tokenize.
  return tokens[index + 2] ?? null;
}

/**
 * The commands inside `$(…)` and backticks, innermost first, so `out=$(npx vercel --prod)`
 * is judged as the deploy it runs.
 */
export function commandSubstitutions(command: string): Array<string> {
  const found: Array<string> = [];
  let text = command;
  for (let guard = 0; guard < 16; guard += 1) {
    const match = /\$\(([^()]*)\)|`([^`]*)`/.exec(text);
    if (match === null) break;
    const inner = (match[1] ?? match[2] ?? "").trim();
    if (inner.length > 0) found.push(inner);
    text = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
  }
  return found;
}

/** The program's base name: `/usr/bin/git` -> `git`. */
export function programBaseName(program: string): string {
  return program.split(/[\\/]/).at(-1) ?? program;
}

/**
 * Codex runs everything as `/bin/zsh -lc "<script>"`; return the script itself so the
 * segments inside are what gets judged. Quoting layers are peeled the way a shell would.
 */
export function unwrapShellWrapper(command: string): string {
  const raw = command.match(/"(?:[^"\\]|\\.)*"|'[^']*'|\S+/g) ?? [];
  let index = 0;
  while (index < raw.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(raw[index]!)) index += 1;
  const program = raw[index]?.split("/").at(-1);
  const flag = raw[index + 1];
  if (!program || !/^(ba|z|da|k)?sh$/.test(program) || !flag || !/^-[a-z]*c[a-z]*$/.test(flag)) {
    return command;
  }
  let position = 0;
  for (let i = 0; i <= index + 1; i += 1)
    position = command.indexOf(raw[i]!, position) + raw[i]!.length;
  return shellUnquote(command.slice(position).trim());
}

export function shellUnquote(text: string): string {
  let out = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote === "'") {
      if (ch === "'") quote = null;
      else out += ch;
    } else if (quote === '"') {
      if (ch === "\\" && i + 1 < text.length && /["\\$`]/.test(text[i + 1]!)) {
        out += text[i + 1]!;
        i += 1;
      } else if (ch === '"') quote = null;
      else out += ch;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "\\" && i + 1 < text.length) {
      out += text[i + 1]!;
      i += 1;
    } else out += ch;
  }
  return out;
}

/**
 * Undoes the cheap tricks that hide a program name from a pattern: `$(echo rm) -rf x`,
 * `` `echo rm` -rf x ``, `$(which vercel) --prod`, `r""m -rf x`, `r'm' -rf x`. Returns text
 * for matching only; the original is still what runs.
 */
export function normalizeForMatching(command: string): string {
  return (
    command
      .replace(/\$\(\s*echo\s+(?:-[a-zA-Z]+\s+)?([^)]+?)\s*\)/g, "$1")
      .replace(/`\s*echo\s+(?:-[a-zA-Z]+\s+)?([^`]+?)\s*`/g, "$1")
      // `$(which vercel) --prod`, `$(command -v rm) -rf x`, `` `type -p git` push ``
      .replace(/\$\(\s*(?:which|command\s+-v|type\s+-[pP]|whence)\s+(\S+?)\s*\)/g, "$1")
      .replace(/`\s*(?:which|command\s+-v|type\s+-[pP]|whence)\s+(\S+?)\s*`/g, "$1")
      .replace(/\$\(\s*npm\s+bin\s*\)\//g, "")
      .replace(/\$\(\s*(?:yarn|pnpm)\s+bin\s*\)\//g, "")
      .replace(/(\w)""(\w)/g, "$1$2")
      .replace(/(\w)''(\w)/g, "$1$2")
      .replace(/(^|\s)(\w)"(\w+)"(?=\s|$)/g, "$1$2$3")
      .replace(/(^|\s)(\w)'(\w+)'(?=\s|$)/g, "$1$2$3")
      .replace(/(^|\s)"(\w+)"(\w)(?=\s|$)/g, "$1$2$3")
      .replace(/(^|\s)'(\w+)'(\w)(?=\s|$)/g, "$1$2$3")
  );
}

export interface FileWrite {
  readonly path: string;
  /** `>>`: adds to the end instead of replacing. */
  readonly append: boolean;
}

/**
 * The files a step's output redirections write: `> f`, `>> f`, `>| f`, `2> f`, `&> f`, `>f`.
 * Not `> /dev/null`, `2>&1` or `>(…)`, and not a `>` inside quotes. A step with any of these
 * changes a file, whatever its program (QA FK-04: `cat > index.html <<EOF` replaced the page).
 */
export function fileWriteTargets(segment: string): Array<FileWrite> {
  const raw = segment.match(/"(?:[^"\\]|\\.)*"|'[^']*'|\S+/g) ?? [];
  const writes: Array<FileWrite> = [];
  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i]!;
    if (token.startsWith('"') || token.startsWith("'")) continue;
    const match = /^(?:\d*|&)(>>?)\|?(.*)$/.exec(token);
    if (match === null) continue;
    let target = match[2]!;
    if (target === "") {
      target = (raw[i + 1] ?? "").replace(/^["']|["']$/g, "");
      i += 1;
    }
    if (target === "" || target.startsWith("&") || target.startsWith("(")) continue;
    if (target === "/dev/null" || target === "/dev/stdout" || target === "/dev/stderr") continue;
    writes.push({ path: target, append: match[1] === ">>" });
  }
  return writes;
}
