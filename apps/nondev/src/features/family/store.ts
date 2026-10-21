// Where the Family profile lives: this browser's localStorage under
// `skycot:family`, guarded like every other preference (storage can be
// blocked). Only the salted hash of the parent code is ever written.
import { useSyncExternalStore } from "react";

import {
  EMPTY_PROFILE,
  FAMILY_KEY,
  createProfile,
  parseProfile,
  serializeProfile,
  verifyCode,
  withChildName,
  withNewCode,
  type FamilyProfile,
  type VerifyOutcome,
} from "./family";

const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function read(): string | null {
  try {
    return window.localStorage.getItem(FAMILY_KEY);
  } catch {
    return null;
  }
}

// useSyncExternalStore wants a referentially stable snapshot; cache by raw text.
let cachedRaw: string | null | undefined;
let cached: FamilyProfile = EMPTY_PROFILE;

export function readFamilyProfile(): FamilyProfile {
  const raw = read();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parseProfile(raw);
  }
  return cached;
}

export function writeFamilyProfile(profile: FamilyProfile): void {
  try {
    if (!profile.enabled && profile.codeHash === null) window.localStorage.removeItem(FAMILY_KEY);
    else window.localStorage.setItem(FAMILY_KEY, serializeProfile(profile));
  } catch {
    // Storage blocked: the profile lasts for this page only.
    cachedRaw = serializeProfile(profile);
    cached = profile;
  }
  notify();
}

export function useFamilyProfile(): FamilyProfile {
  return useSyncExternalStore(subscribe, readFamilyProfile, () => EMPTY_PROFILE);
}

export async function enableFamily(input: {
  readonly childName: string | null;
  readonly code: string;
}): Promise<FamilyProfile> {
  const profile = await createProfile({ ...input, now: Date.now() });
  writeFamilyProfile(profile);
  return profile;
}

/** Turning off forgets everything, the child's name included: nothing lingers for the next person. */
export function disableFamily(): void {
  writeFamilyProfile(EMPTY_PROFILE);
}

export async function changeParentCode(code: string): Promise<void> {
  writeFamilyProfile(await withNewCode(readFamilyProfile(), code));
}

export function renameChild(childName: string | null): void {
  writeFamilyProfile(withChildName(readFamilyProfile(), childName));
}

/** One attempt: compares, records the outcome (counter or lockout) and reports it. */
export async function tryParentCode(code: string): Promise<VerifyOutcome> {
  const outcome = await verifyCode(readFamilyProfile(), code, Date.now());
  writeFamilyProfile(outcome.profile);
  return outcome;
}
