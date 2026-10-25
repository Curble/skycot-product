// nondev-seam: skycot-mobile-page-logic
import { MAX_PAGE_SITES, reportedSite } from "@t3tools/skycot-rules/page-internet";

export const GAME_BUTTONS_DEFAULT = false;

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
  readonly reason: "too-big" | null;
  readonly page: string | null;
};

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

export function reportedSites(
  data: unknown,
  current: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const site = reportedSite(data);
  if (site === null || current.includes(site) || current.length >= MAX_PAGE_SITES) return current;
  return [...current, site];
}

export function pageAskWaitingCopy(): string {
  return "We've let your grown-ups know. The parent code stays on this device while they decide.";
}

const buttonsByPage = new Map<string, boolean>();
export function gameButtonsForPage(key: string): boolean {
  return buttonsByPage.get(key) ?? GAME_BUTTONS_DEFAULT;
}
export function rememberGameButtons(key: string, enabled: boolean): void {
  buttonsByPage.set(key, enabled);
}
