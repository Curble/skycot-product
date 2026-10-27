// nondev-seam: skycot-mobile-page-logic
// nondev-seam: skycot-iphone-q39-page-copy
// nondev-seam: skycot-iphone-q50-page-logic
import {
  MAX_PAGE_SITES,
  reportedPageLink,
  reportedSite,
} from "@t3tools/skycot-rules/page-internet";

export const GAME_BUTTONS_DEFAULT = false;
const buttonsByPage = new Map<string, boolean>();

export function pageHasOwnGameControls(html: string): boolean {
  const buttons =
    html.match(
      /<button\b[^>]*>[\s\S]*?<\/button\s*>|<input\b[^>]*>|<\w+\b[^>]*\brole\s*=\s*["']button["'][^>]*>[\s\S]*?<\/\w+\s*>/giu,
    ) ?? [];
  return buttons.some((button) =>
    /(?:\barrow\s*(?:up|down|left|right)\b|\b(?:up|down|left|right|kick|jump|move|shoot|fire)\b|↑|↓|←|→)/iu.test(
      button.replace(/<([\w-]+)\b([^>]*)>/gu, "$2 ").replace(/<\/?[^>]+>/gu, " "),
    ),
  );
}

export function gameButtonsForPage(key: string, hasOwnControls = false): boolean {
  return buttonsByPage.get(key) ?? (!hasOwnControls && GAME_BUTTONS_DEFAULT);
}

export function pageToolbarCopy(childView: boolean, fullScreen: boolean) {
  return {
    done: childView ? "Done" : "Back",
    fullScreen: fullScreen ? "Exit" : "Full",
    extraButtons: "More",
    help: "Help",
  } as const;
}

export function pageFullScreenState(
  local: boolean,
  seeded: boolean | undefined,
  shellControls: boolean,
): boolean {
  return shellControls ? (seeded ?? local) : local;
}

export function claimQuestionAnswer(answered: Set<string>, questionId: string): boolean {
  if (answered.has(questionId)) return false;
  answered.add(questionId);
  return true;
}

export function pageThing(page: string): "game" | "card" | "page" {
  if (/card|birthday/iu.test(page)) return "card";
  if (/game|play|bounce/iu.test(page)) return "game";
  return "page";
}

export const GAME_KEY_SCRIPTS = {
  ArrowUp: {
    pressIn:
      "(function(){var e=new KeyboardEvent('keydown',{key:'ArrowUp',code:'ArrowUp',keyCode:38,which:38,bubbles:false});document.dispatchEvent(e);window.dispatchEvent(e)})()",
    pressOut:
      "(function(){var e=new KeyboardEvent('keyup',{key:'ArrowUp',code:'ArrowUp',keyCode:38,which:38,bubbles:false});document.dispatchEvent(e);window.dispatchEvent(e)})()",
  },
  ArrowDown: {
    pressIn:
      "(function(){var e=new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',keyCode:40,which:40,bubbles:false});document.dispatchEvent(e);window.dispatchEvent(e)})()",
    pressOut:
      "(function(){var e=new KeyboardEvent('keyup',{key:'ArrowDown',code:'ArrowDown',keyCode:40,which:40,bubbles:false});document.dispatchEvent(e);window.dispatchEvent(e)})()",
  },
  ArrowLeft: {
    pressIn:
      "(function(){var e=new KeyboardEvent('keydown',{key:'ArrowLeft',code:'ArrowLeft',keyCode:37,which:37,bubbles:false});document.dispatchEvent(e);window.dispatchEvent(e)})()",
    pressOut:
      "(function(){var e=new KeyboardEvent('keyup',{key:'ArrowLeft',code:'ArrowLeft',keyCode:37,which:37,bubbles:false});document.dispatchEvent(e);window.dispatchEvent(e)})()",
  },
  ArrowRight: {
    pressIn:
      "(function(){var e=new KeyboardEvent('keydown',{key:'ArrowRight',code:'ArrowRight',keyCode:39,which:39,bubbles:false});document.dispatchEvent(e);window.dispatchEvent(e)})()",
    pressOut:
      "(function(){var e=new KeyboardEvent('keyup',{key:'ArrowRight',code:'ArrowRight',keyCode:39,which:39,bubbles:false});document.dispatchEvent(e);window.dispatchEvent(e)})()",
  },
  " ": {
    pressIn:
      "(function(){var e=new KeyboardEvent('keydown',{key:' ',code:'Space',keyCode:32,which:32,bubbles:false});document.dispatchEvent(e);window.dispatchEvent(e)})()",
    pressOut:
      "(function(){var e=new KeyboardEvent('keyup',{key:' ',code:'Space',keyCode:32,which:32,bubbles:false});document.dispatchEvent(e);window.dispatchEvent(e)})()",
  },
} as const;

export type PlayCopy = {
  readonly html: string | null;
  readonly reason: "too-big" | "unpackable-module" | "remote-script" | null;
  readonly needs: {
    readonly scripts: ReadonlyArray<string>;
    readonly other: ReadonlyArray<string>;
  };
  readonly page: string | null;
};

export type PlayNoticeKind = "engine-update" | "too-big" | "unpackable-module" | "remote-script";

export function playNoticeCopy(
  kind: PlayNoticeKind,
  childView: boolean,
  hosts: ReadonlyArray<string> = [],
  device = "iPad",
  thing: "game" | "card" | "page" = "game",
): {
  readonly title: string;
  readonly message: string;
  readonly grownUp: string | null;
  readonly tellSamLabel: string | null;
  readonly tellSam: string | null;
} {
  if (kind === "engine-update")
    return {
      title: `This ${thing} can't play here yet`,
      message: childView
        ? `This ${thing} needs a newer SKYCOT on the Mac to play here. Ask a grown-up to update it. You're seeing a picture of the ${thing}.`
        : `This ${thing} needs a newer SKYCOT on the Mac to play here. You're seeing a picture of the ${thing}.`,
      grownUp: childView ? null : "Update SKYCOT on the Mac (Settings > About).",
      tellSamLabel: null,
      tellSam: null,
    };
  if (kind === "remote-script")
    return {
      title: `This ${thing} can't play here yet`,
      message: `This ${thing} uses a tool from the internet (${hosts.length > 0 ? hosts.join(", ") : "a website"}), which can't run on this ${device}. It works on the Mac. Ask Sam to make it work without the internet.`,
      grownUp: null,
      tellSamLabel: "Tell Sam",
      tellSam: `Please make my ${thing} work without loading anything from the internet, so it plays on this ${device}.`,
    };
  if (kind === "too-big")
    return {
      title: `This ${thing} can't play here yet`,
      message: `This ${thing} is too big to play on this ${device}. You're seeing a picture of the ${thing}.`,
      grownUp: childView
        ? null
        : "The Mac could not pack this page within the playable size limit.",
      tellSamLabel: null,
      tellSam: null,
    };
  return {
    title: `This ${thing} can't play here yet`,
    message: `A part of this ${thing} is missing, so it can't play on this ${device}. You're seeing a picture of the ${thing}.`,
    grownUp: childView
      ? null
      : "Keep the game's modules inside the project folder, then try again.",
    tellSamLabel: null,
    tellSam: null,
  };
}

export function playableCopy(result: {
  readonly ok: boolean;
  readonly value?: PlayCopy;
}): PlayCopy | null {
  return result.ok && result.value?.html !== null && result.value?.html !== undefined
    ? result.value
    : null;
}

/**
 * Where the play viewer may navigate: only its own document (about:blank / about:srcdoc).
 * A game's pictures and sounds (data:, blob:) load without navigating; a page that moves to a
 * data: or blob: document would leave its offline rules behind, so that is never allowed.
 */
export function allowsPlayNavigation(url: string): boolean {
  return /^about:(?:blank|srcdoc)(?:[?#].*)?$/iu.test(url);
}

export function isPageLinkMessage(value: unknown): boolean {
  return reportedPageLink(value) !== null;
}

export function reportedSites(
  data: unknown,
  current: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const site = reportedSite(data);
  if (site === null || current.includes(site) || current.length >= MAX_PAGE_SITES) return current;
  return [...current, site];
}

export type PageDiagnosticEntry = {
  readonly kind: "error" | "rejection" | "policy" | "load" | "warn";
  readonly text: string;
};

export type PageDiagnosticFacts = {
  readonly ios: string | null;
  readonly safari: string | null;
  readonly dpr: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly packedBytes: number | null;
  readonly frames: number | null;
  readonly blank: boolean | null;
};

export type PageDiagnostics = {
  readonly entries: ReadonlyArray<PageDiagnosticEntry>;
  readonly facts: PageDiagnosticFacts;
};

export const EMPTY_PAGE_DIAGNOSTICS: PageDiagnostics = {
  entries: [],
  facts: {
    ios: null,
    safari: null,
    dpr: null,
    width: null,
    height: null,
    packedBytes: null,
    frames: null,
    blank: null,
  },
};

const DIAGNOSTIC_LIMIT = 30;
const diagnosticText = (value: string) =>
  value
    .replace(/https?:\/\/[^\s)]+/giu, "website")
    .replace(
      /(?:\/[^\s():]+)+\.(?:js|mjs|html?)(?=[:)]|$)/giu,
      (path) => path.split("/").at(-1) ?? "game file",
    )
    .replace(/\s+at\s+[^\n]+/gu, "")
    .replace(/[\r\n\t]+/gu, " ")
    .trim()
    .slice(0, 200);

export function parsePageDiagnostic(value: unknown, current: PageDiagnostics): PageDiagnostics {
  let message = value;
  if (typeof message === "string") {
    try {
      message = JSON.parse(message) as unknown;
    } catch {
      return current;
    }
  }
  if (typeof message !== "object" || message === null) return current;
  const record = message as Record<string, unknown>;
  if (record.skycot !== "diag") return current;
  const inputFacts =
    typeof record.facts === "object" && record.facts !== null
      ? (record.facts as Record<string, unknown>)
      : {};
  const number = (key: string) =>
    typeof inputFacts[key] === "number" && Number.isFinite(inputFacts[key])
      ? Math.max(0, inputFacts[key] as number)
      : (current.facts[key as keyof PageDiagnosticFacts] as number | null);
  const facts: PageDiagnosticFacts = {
    ios:
      typeof inputFacts.ios === "string"
        ? inputFacts.ios
            .replace(/_/gu, ".")
            .replace(/[^0-9.]/gu, "")
            .slice(0, 20)
        : current.facts.ios,
    safari:
      typeof inputFacts.safari === "string"
        ? inputFacts.safari.replace(/[^0-9.]/gu, "").slice(0, 20)
        : current.facts.safari,
    dpr: number("dpr"),
    width: number("width"),
    height: number("height"),
    packedBytes: number("packedBytes"),
    frames: number("frames"),
    blank: typeof inputFacts.blank === "boolean" ? inputFacts.blank : current.facts.blank,
  };
  const rawEntries = Array.isArray(record.entries) ? record.entries : [];
  const additions = rawEntries.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (
      !["error", "rejection", "policy", "load", "warn"].includes(String(row.kind)) ||
      typeof row.text !== "string"
    )
      return [];
    const text = diagnosticText(row.text);
    return text ? [{ kind: row.kind as PageDiagnosticEntry["kind"], text }] : [];
  });
  return {
    facts,
    entries: [...current.entries, ...additions].slice(-DIAGNOSTIC_LIMIT),
  };
}

export function pageLooksWrong(diagnostics: PageDiagnostics, elapsedAfterLoadMs: number): boolean {
  if ((diagnostics.facts.frames ?? 0) > 0 && diagnostics.facts.blank !== true) return false;
  return (
    diagnostics.entries.some((entry) => entry.kind !== "warn") ||
    diagnostics.facts.blank === true ||
    (elapsedAfterLoadMs >= 3000 &&
      (diagnostics.facts.frames === null || diagnostics.facts.frames < 1))
  );
}

export function diagnosticSheetCopy(
  diagnostics: PageDiagnostics,
  childView: boolean,
  engine?: FridgePlayDiag,
  device = "iPad",
  thing: "game" | "card" | "page" = "game",
): {
  readonly headline: string;
  readonly lines: ReadonlyArray<string>;
  readonly grownUpLines: ReadonlyArray<string>;
  readonly tellSam: string;
} {
  const lines: string[] = [];
  const facts = diagnostics.facts;
  if (facts.ios && Number(facts.ios.split(".")[0]) < 18)
    lines.push(
      `This ${device}'s web engine is older (${device === "iPad" ? "iPadOS" : "iOS"} ${facts.ios}).`,
    );
  for (const file of engine?.missingFiles.slice(0, 3) ?? [])
    lines.push(`A ${thing} file is missing: ${safeFileName(file)}`);
  for (const entry of diagnostics.entries.slice(-4)) {
    if (entry.kind === "load")
      lines.push(
        `A picture or sound couldn't be found: ${entry.text.replace(/^(?:img|audio|video|source):\s*/iu, "") || `${thing} file`}`,
      );
    else if (entry.kind === "policy") {
      const host = /\bblocked ([\w.-]+)/iu.exec(entry.text)?.[1];
      lines.push(`The ${device} stopped the ${thing} from using ${host ?? "something it needed"}.`);
      lines.push(
        "This page tried to get something from the internet. A grown-up can allow it on the Mac.",
      );
    } else if (entry.kind === "error" || entry.kind === "rejection")
      lines.push(`Something in the ${thing}'s code went wrong.`);
    else lines.push(`The ${thing} showed a warning: ${entry.text}`);
  }
  if (facts.blank === true) lines.push(`The ${thing} looks empty on this ${device}.`);
  const running = (facts.frames ?? 0) > 0 && facts.blank !== true;
  if (running)
    lines.splice(
      0,
      lines.length,
      `Your ${thing} is running on this ${device}. You can keep using it.`,
    );
  while (lines.length < 3) {
    const fallback = running
      ? [`You can keep using your ${thing}.`, "A grown-up can help if something is wrong."][
          lines.length - 1
        ]!
      : [
          `The ${thing} opened on this ${device}.`,
          "A grown-up can copy these clues to help fix it.",
          `The ${thing} did not start on this ${device}.`,
        ][lines.length]!;
    lines.push(fallback);
  }
  const shown = lines.slice(0, childView ? 4 : 6);
  const firstProblem = diagnostics.entries.find((entry) => entry.kind !== "warn");
  const shortError = (
    running
      ? "one small thing needs changing"
      : firstProblem?.kind === "error" || firstProblem?.kind === "rejection"
        ? `something in the ${thing}'s code went wrong`
        : (firstProblem?.text ?? engine?.missingFiles[0] ?? "it did not start")
  ).slice(0, 100);
  return {
    headline: running
      ? "Is something not working?"
      : `This ${thing} hit a problem on this ${device}`,
    lines: shown,
    grownUpLines: childView
      ? []
      : [
          `Safari ${facts.safari ?? "unknown"}; pixel ratio ${facts.dpr ?? "unknown"}; viewport ${facts.width ?? "?"}×${facts.height ?? "?"}.`,
          `The packed page has ${engine?.packedBytes ?? 0} bytes across ${engine?.embeddedFiles ?? 0} files; modules ${engine?.modulesBundled ? "were bundled" : "were not bundled"}.`,
          ...diagnostics.entries.slice(-2).map((entry) => `${entry.kind}: ${entry.text}`),
        ],
    tellSam: running
      ? `My ${thing} is running on this ${device}, but ${shortError}. Please change that.`
      : `My ${thing} doesn't work on this ${device}: ${shortError}. Please fix it.`,
  };
}

export type FridgePlayDiag = {
  readonly reason: PlayCopy["reason"];
  readonly needs: PlayCopy["needs"];
  readonly packedBytes: number;
  readonly embeddedFiles: number;
  readonly modulesBundled: boolean;
  readonly missingFiles: ReadonlyArray<string>;
};

function safeFileName(value: string): string {
  const clean = value.replace(/[?#].*$/u, "");
  return (
    clean
      .split(/[\\/]/u)
      .at(-1)
      ?.replace(/[^\w.-]/gu, "_")
      .slice(0, 80) || "game file"
  );
}

export function diagnosticReport(
  diagnostics: PageDiagnostics,
  engine: FridgePlayDiag,
  appBuild: string,
  mode: "playable" | "still copy",
): string {
  const lines = [
    `SKYCOT game report (build ${diagnosticText(appBuild).slice(0, 32) || "unknown"})`,
    `Viewer: ${mode}`,
    `Engine reason: ${engine.reason ?? "none"}`,
    `Needs: scripts=${engine.needs.scripts.map(safeFileName).slice(0, 8).join(",") || "none"}; other=${engine.needs.other.map(safeFileName).slice(0, 8).join(",") || "none"}`,
    `Pack: ${engine.packedBytes} bytes, ${engine.embeddedFiles} files, modules bundled=${engine.modulesBundled}`,
    `Missing files: ${engine.missingFiles.slice(0, 8).map(safeFileName).join(",") || "none"}`,
    `iOS ${diagnostics.facts.ios ?? "unknown"}; Safari ${diagnostics.facts.safari ?? "unknown"}; DPR ${diagnostics.facts.dpr ?? "unknown"}; viewport ${diagnostics.facts.width ?? "?"}x${diagnostics.facts.height ?? "?"}`,
    `Frames in first 2s: ${diagnostics.facts.frames ?? "unknown"}; blank page: ${diagnostics.facts.blank ?? "unknown"}`,
    ...diagnostics.entries
      .slice(-DIAGNOSTIC_LIMIT)
      .map((entry) => `${entry.kind}: ${diagnosticText(entry.text)}`),
  ];
  return lines.join("\n").slice(0, 4000);
}

export function pageAskWaitingCopy(): string {
  return "We've let your grown-ups know. The parent code stays on this device while they decide.";
}

export function rememberGameButtons(key: string, enabled: boolean): void {
  buttonsByPage.set(key, enabled);
}
