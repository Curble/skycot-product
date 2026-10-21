// `useFamily()`: the engine's Family profile as the UI sees it, which actions it locks, and
// `requireParentCode`, which opens the code sheet over whatever is on screen and resolves
// with whether the engine accepted the code (and recorded the grown-up's "yes" for this
// device). The provider lives once, above the shell, so a sheet opened from inside another
// sheet still stacks correctly (ui/useModal).
import { KeyRound } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import type { FamilyResult } from "./api";
import { actionReason } from "./copy";
import { familyOn, isFamilyLocked, purposeFor, type FamilyAction, type FamilyView } from "./family";
import { ParentCodeEntry, useParentCodeEntry, type ParentCodeAttempt } from "./ParentCodeEntry";
import {
  disableFamily,
  moveLegacyProfile,
  readFamilyView,
  refreshFamily,
  tryParentCode,
  useFamilyView,
} from "./store";

export interface ParentCodeOptions {
  /** For "approve": the one card the grown-up is allowing. */
  readonly requestId?: string;
}

export interface FamilyApi {
  readonly profile: FamilyView;
  /** On for the UI: the engine says so, or a browser-only profile is waiting to move. */
  readonly enabled: boolean;
  readonly isLocked: (action: FamilyAction) => boolean;
  /** Resolves true at once when the action is not locked; otherwise after the sheet. */
  readonly requireParentCode: (
    action: FamilyAction,
    options?: ParentCodeOptions,
  ) => Promise<boolean>;
}

interface Pending {
  readonly action: FamilyAction;
  readonly options: ParentCodeOptions;
  readonly resolve: (ok: boolean) => void;
}

/**
 * What one code try does for an action. A browser-only profile is carried to the engine
 * first, with the same code, so the first prompt after the update also moves it.
 */
export function attemptFor(action: FamilyAction, options: ParentCodeOptions): ParentCodeAttempt {
  return async (code) => {
    if (readFamilyView().legacy) {
      const problem = await moveLegacyProfile(code);
      if (problem !== null) return { ok: false, reason: "wrong-code", message: problem };
    }
    if (action === "disableFamily") return disableFamily(code);
    const purpose = purposeFor(action);
    if (purpose === null) {
      return { ok: true, value: null } satisfies FamilyResult<null>;
    }
    return tryParentCode(code, purpose, options.requestId);
  };
}

const FamilyContext = createContext<FamilyApi | null>(null);

function makeApi(
  view: FamilyView,
  open: ((pending: Omit<Pending, "resolve">) => Promise<boolean>) | null,
): FamilyApi {
  return {
    profile: view,
    enabled: familyOn(view),
    isLocked: (action) => isFamilyLocked(view, action),
    requireParentCode: (action, options = {}) => {
      if (!isFamilyLocked(view, action)) return Promise.resolve(true);
      return open === null ? Promise.resolve(false) : open({ action, options });
    },
  };
}

export function FamilyProvider({ children }: { readonly children: ReactNode }) {
  const view = useFamilyView();
  const [pending, setPending] = useState<Pending | null>(null);

  // The engine is the truth: ask on mount and whenever this window comes back to the front
  // (a parent may have changed it from another device).
  useEffect(() => {
    void refreshFamily();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshFamily();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const api = useMemo(
    () =>
      makeApi(
        view,
        (request) =>
          new Promise<boolean>((resolve) => {
            setPending({
              ...request,
              resolve: (ok) => {
                setPending(null);
                resolve(ok);
              },
            });
          }),
      ),
    [view],
  );

  return (
    <FamilyContext.Provider value={api}>
      {children}
      {pending ? (
        <ParentCodeSheet
          key={`${pending.action}:${pending.options.requestId ?? ""}`}
          pending={pending}
        />
      ) : null}
    </FamilyContext.Provider>
  );
}

/** Outside the provider (tests, isolated mounts) the profile still reads; the sheet cannot open. */
export function useFamily(): FamilyApi {
  const context = useContext(FamilyContext);
  const view = useFamilyView();
  return context ?? makeApi(view, null);
}

function ParentCodeSheet({ pending }: { readonly pending: Pending }) {
  const entry = useParentCodeEntry(attemptFor(pending.action, pending.options), () =>
    pending.resolve(true),
  );
  const cancel = () => pending.resolve(false);
  return (
    <Sheet
      open
      onClose={cancel}
      icon={KeyRound}
      iconTone="grey"
      title={pending.action === "approve" ? "Ask a grown-up" : "Parent code"}
      description={actionReason(pending.action)}
      sober
      initialFocus="first"
      actions={
        <>
          <Button onClick={cancel} disabled={entry.busy}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!entry.canSubmit} onClick={() => void entry.submit()}>
            {entry.busy ? "Checking…" : pending.action === "approve" ? "Allow" : "Continue"}
          </Button>
        </>
      }
    >
      <ParentCodeEntry entry={entry} />
    </Sheet>
  );
}
