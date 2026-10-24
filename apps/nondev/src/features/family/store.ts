// A thin view over the engine's Family profile. The engine decides; this module remembers its
// last answer (and caches it in localStorage for first paint only), refreshes after every
// change, and carries a profile set up before the move over to the engine.
import { useSyncExternalStore } from "react";

import { familyApi, type ChildPatch, type FamilyResult, type UnlockToken } from "./api";
import type { ChildAvatar } from "./children";
import {
  EMPTY_VIEW,
  FAMILY_CACHE_KEY,
  FAMILY_KEY,
  parseCachedView,
  parseProfile,
  serializeCachedView,
  verifyCode,
  viewFromStatus,
  type FamilyPurpose,
  type FamilyView,
  type ServerFamilyStatus,
} from "./family";

const listeners = new Set<() => void>();

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the cache lasts for this page only, which is all it is for.
  }
}

function legacyPresent(): boolean {
  return parseProfile(readStorage(FAMILY_KEY)).enabled;
}

let view: FamilyView =
  typeof window === "undefined"
    ? EMPTY_VIEW
    : parseCachedView(readStorage(FAMILY_CACHE_KEY), legacyPresent());

function setView(next: FamilyView): void {
  view = next;
  writeStorage(FAMILY_CACHE_KEY, next.enabled ? serializeCachedView(next) : null);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For code outside React (the Questions labels' atom): told whenever the view changes. */
export function subscribeFamilyView(listener: () => void): () => void {
  return subscribe(listener);
}

export function readFamilyView(): FamilyView {
  return view;
}

export function useFamilyView(): FamilyView {
  return useSyncExternalStore(subscribe, readFamilyView, () => EMPTY_VIEW);
}

function applyStatus(status: ServerFamilyStatus): void {
  setView(viewFromStatus(status, Date.now(), legacyPresent(), view));
}

/** A failed code try tells us the counter: keep the prompt's sentence and lock in step. */
function applyFailure(result: Extract<FamilyResult<unknown>, { ok: false }>): void {
  if (result.reason === "locked") {
    setView({
      ...view,
      attemptsLeft: 0,
      lockedUntil: Date.now() + (result.remainingMs ?? 5 * 60_000),
    });
  } else if (result.reason === "wrong-code" && result.attemptsLeft !== undefined) {
    setView({ ...view, attemptsLeft: result.attemptsLeft });
  } else if (result.reason === "not-enabled") {
    void refreshFamily();
  }
}

async function settle<A>(
  promise: Promise<FamilyResult<A>>,
  onValue?: (value: A) => void,
): Promise<FamilyResult<A>> {
  const result = await promise;
  if (result.ok) onValue?.(result.value);
  else applyFailure(result);
  return result;
}

export function refreshFamily(): Promise<FamilyResult<ServerFamilyStatus>> {
  return settle(familyApi.status(), applyStatus);
}

export function enableFamily(input: {
  readonly childName: string | null;
  readonly code: string;
}): Promise<FamilyResult<ServerFamilyStatus>> {
  return settle(familyApi.enable(input), (status) => {
    // The engine has it now; the browser-only copy would only confuse the next visit.
    writeStorage(FAMILY_KEY, null);
    applyStatus(status);
  });
}

/** Turning off forgets everything on the engine, the child's name included. */
export function disableFamily(code: string): Promise<FamilyResult<ServerFamilyStatus>> {
  return settle(familyApi.disable({ code }), (status) => {
    writeStorage(FAMILY_KEY, null);
    applyStatus(status);
  });
}

export function changeParentCode(
  oldCode: string,
  newCode: string,
): Promise<FamilyResult<ServerFamilyStatus>> {
  return settle(familyApi.changeCode({ oldCode, newCode }), applyStatus);
}

export function renameChild(childName: string | null): Promise<FamilyResult<ServerFamilyStatus>> {
  return settle(familyApi.rename({ childName }), applyStatus);
}

export function addChild(child: ChildPatch) {
  return settle(familyApi.addChild(child), ({ status }) => applyStatus(status));
}

export function updateChild(childId: string, patch: ChildPatch) {
  return settle(familyApi.updateChild({ childId, patch }), applyStatus);
}

export function removeChild(childId: string) {
  return settle(familyApi.removeChild({ childId }), applyStatus);
}

/** The child's own look and text size (no code: picking a look is open to children). */
export function saveOwnLook(input: { readonly look?: string; readonly largerText?: boolean }) {
  return settle(familyApi.look(input), applyStatus);
}

/** The engine's answer about who is using this device, from a choice or a heartbeat. */
export function applySession(session: {
  readonly childId: string | null;
  readonly needsChoice: boolean;
}) {
  const known =
    session.childId !== null && view.children.some((child) => child.id === session.childId)
      ? session.childId
      : null;
  if (known === view.currentChildId && session.needsChoice === view.needsChoice) return;
  const child = view.children.find((candidate) => candidate.id === known);
  setView({
    ...view,
    currentChildId: known,
    needsChoice: session.needsChoice,
    childName: child?.name ?? (view.children.length === 0 ? view.childName : null),
  });
}

const parentYesListeners = new Set<(purpose: FamilyPurpose) => void>();

/** Hears every parent code the engine accepted on this device (the recap's end-of-session card). */
export function onParentYes(listener: (purpose: FamilyPurpose) => void): () => void {
  parentYesListeners.add(listener);
  return () => {
    parentYesListeners.delete(listener);
  };
}

/** One code try for a grown-up's "yes"; the engine records the grant for this device. */
export function tryParentCode(
  code: string,
  purpose: FamilyPurpose,
  requestId?: string,
): Promise<FamilyResult<UnlockToken>> {
  return settle(
    familyApi.verify({ code, purpose, ...(requestId === undefined ? {} : { requestId }) }),
    () => {
      setView({ ...view, attemptsLeft: 5, lockedUntil: null });
      // The engine says how long the new "yes" lasts.
      void refreshFamily();
      for (const listener of parentYesListeners) listener(purpose);
    },
  );
}

/** A grown-up allows an assistant SKYCOT can't lock down, with the parent code. */
export function allowAssistant(
  driver: string,
  code: string,
): Promise<FamilyResult<ServerFamilyStatus>> {
  return settle(familyApi.allowAssistant({ driver, code }), applyStatus);
}

/** The parent's "Trusted add-ons download by themselves", with the parent code. */
export function setTrustedAddOns(
  on: boolean,
  code: string,
): Promise<FamilyResult<ServerFamilyStatus>> {
  return settle(familyApi.setTrustedAddOns({ on, code }), applyStatus);
}

/** Takes an allowance back (no code). That assistant's next Family turn is refused. */
export function stopAllowingAssistant(driver: string): Promise<FamilyResult<ServerFamilyStatus>> {
  return settle(familyApi.stopAllowingAssistant({ driver }), applyStatus);
}

/** Ends this device's grants (a parent leaving Advanced mode). */
export function lockFamilyGrants(): Promise<FamilyResult<ServerFamilyStatus>> {
  return settle(familyApi.lock(), applyStatus);
}

/**
 * Carries a profile set up before the engine kept it: the code is checked against the old
 * browser copy (with its own wrong-try counter), then the same name and code move to the
 * engine. Resolves with a sentence to show, or null when it moved.
 */
export async function moveLegacyProfile(code: string): Promise<string | null> {
  const legacy = parseProfile(readStorage(FAMILY_KEY));
  if (!legacy.enabled) return null;
  const outcome = await verifyCode(legacy, code, Date.now());
  writeStorage(FAMILY_KEY, JSON.stringify(outcome.profile));
  if (!outcome.ok) {
    return outcome.kind === "locked"
      ? "Too many tries. Try again in a few minutes."
      : "That's not the parent code this browser remembers.";
  }
  const moved = await enableFamily({ childName: legacy.childName, code });
  return moved.ok ? null : moved.message;
}

// Who is who: grown-ups (the family's Mac, with the Family settings' yes).
export function addGrownUp(person: {
  readonly name: string | null;
  readonly avatar?: ChildAvatar;
}) {
  return settle(familyApi.addGrownUp(person), applyStatus);
}

export function updateGrownUp(
  personId: string,
  patch: { readonly name?: string | null; readonly avatar?: ChildAvatar },
) {
  return settle(familyApi.updateGrownUp({ personId, patch }), applyStatus);
}

export function removeGrownUp(personId: string) {
  return settle(familyApi.removeGrownUp({ personId }), applyStatus);
}

/**
 * Any engine answer that may carry a code try (a grown-up's phone saying yes with the code):
 * a wrong or locked code updates the counter shown here, like every other prompt.
 */
export function settleWithCode<A>(promise: Promise<FamilyResult<A>>): Promise<FamilyResult<A>> {
  return settle(promise);
}
