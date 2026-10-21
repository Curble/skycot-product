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
 * Drops `cd x`-style wrappers, env assignments, `sudo`, `time`, `exec` and `bash -c "…"`
 * layers to find the real program and its arguments.
 */
export function programTokens(segment: string): Array<string> {
  let tokens = tokenize(segment);
  while (tokens.length > 0) {
    const head = tokens[0]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) tokens = tokens.slice(1);
    else if (
      head === "env" ||
      head === "time" ||
      head === "exec" ||
      head === "command" ||
      head === "nice" ||
      head === "nohup"
    )
      tokens = tokens.slice(1);
    else if (head === "sudo" || head === "doas") tokens = tokens.slice(1);
    else if (SHELL_PREFIX.has(head)) tokens = tokens.slice(1);
    else break;
  }
  if (tokens.length > 0 && SHELL_CONTROL.has(tokens[0]!)) return [];
  if (
    tokens.length >= 3 &&
    /^(ba|z|da|k)?sh$/.test(tokens[0]!.split("/").at(-1)!) &&
    /^-[a-z]*c[a-z]*$/.test(tokens[1]!)
  ) {
    return programTokens(tokens.slice(2).join(" "));
  }
  return tokens;
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
 * `` `echo rm` -rf x ``, `r""m -rf x`, `r'm' -rf x`. Returns text for matching only; the
 * original is still what runs.
 */
export function normalizeForMatching(command: string): string {
  return command
    .replace(/\$\(\s*echo\s+(?:-[a-zA-Z]+\s+)?([^)]+?)\s*\)/g, "$1")
    .replace(/`\s*echo\s+(?:-[a-zA-Z]+\s+)?([^`]+?)\s*`/g, "$1")
    .replace(/(\w)""(\w)/g, "$1$2")
    .replace(/(\w)''(\w)/g, "$1$2")
    .replace(/(^|\s)(\w)"(\w+)"(?=\s|$)/g, "$1$2$3")
    .replace(/(^|\s)(\w)'(\w+)'(?=\s|$)/g, "$1$2$3")
    .replace(/(^|\s)"(\w+)"(\w)(?=\s|$)/g, "$1$2$3")
    .replace(/(^|\s)'(\w+)'(\w)(?=\s|$)/g, "$1$2$3");
}
