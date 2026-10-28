// `useFamily()`: the engine's Family profile as the UI sees it, which actions it locks, and
// `requireParentCode`, which opens the code sheet over whatever is on screen and resolves
// with whether the engine accepted the code (and recorded the grown-up's "yes" for this
// device). The provider lives once, above the shell, so a sheet opened from inside another
// sheet still stacks correctly (ui/useModal).
import { KeyRound } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { Button } from "../../ui/Button";
import {
  clearGrownUpReturnChild,
  endGrownUpSession,
  grownUpReturnChild,
  grownUpSessionFor,
  readGrownUpSessionId,
  startGrownUpSession,
} from "./grownUpSession";
import { openChildPicker } from "../family-limits/FamilyLimitsHost";
import { consumeHandoff } from "./handoff";
import { chooseChild } from "../family-limits/store";
import { Sheet } from "../../ui/Sheet";
import type { FamilyResult } from "./api";
import { actionReason, familySteps } from "./copy";
import {
  asksEachStep,
  familyGrantOpen,
  familyOn,
  grownUpMinutesLeft,
  isFamilyLocked,
  purposeFor,
  type FamilyAction,
  type FamilyView,
} from "./family";
import { ParentCodeEntry, useParentCodeEntry, type ParentCodeAttempt } from "./ParentCodeEntry";
import {
  disableFamily,
  approveInGrownUpSession,
  prepareUpdateInGrownUpSession,
  lockFamilyGrants,
  moveLegacyProfile,
  readFamilyView,
  refreshFamily,
  renewGrownUpSession,
  setWelcome,
  tryParentCode,
  useFamilyView,
} from "./store";

export interface ParentCodeOptions {
  /** For "approve": the one card the grown-up is allowing. */
  readonly requestId?: string;
  /** For "approve": the card's own reason, shown on the code sheet. */
  readonly reason?: string | null;
  readonly code?: string;
  readonly scope?: "once" | "project";
}

export interface FamilyApi {
  readonly profile: FamilyView;
  /** On for the UI: the engine says so, or a browser-only profile is waiting to move. */
  readonly enabled: boolean;
  readonly isLocked: (action: FamilyAction) => boolean;
  /** Records how the first-run welcome ended (the engine holds it). Resolves false if it failed. */
  readonly setWelcome: (state: "done" | "skipped") => Promise<boolean>;
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
    return tryParentCode(
      code,
      purpose,
      options.requestId,
      options.scope === undefined ? undefined : { scope: options.scope },
    );
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
    setWelcome: (state) => setWelcome(state).then((result) => result.ok),
    requireParentCode: (action, options = {}) => {
      if (options.code !== undefined) {
        return attemptFor(action, options)(options.code).then((result) => result.ok);
      }
      const grownUp =
        view.me.kind === "shared" &&
        grownUpSessionFor(readGrownUpSessionId(), view, Date.now()) !== null;
      // A grown-up-mode shortcut that fails (the engine would not confirm it) is never the end:
      // the ordinary parent-code sheet comes up instead of nothing happening.
      const askForCode = () => (open === null ? Promise.resolve(false) : open({ action, options }));
      if (grownUp && action === "approve" && options.requestId) {
        return approveInGrownUpSession(options.requestId, options.scope).then((ok) =>
          ok ? true : askForCode(),
        );
      }
      if (grownUp && action === "restartToUpdate") {
        return prepareUpdateInGrownUpSession().then((ok) => (ok ? true : askForCode()));
      }
      if (grownUp && familyGrantOpen(view, action, Date.now())) {
        void renewGrownUpSession();
        return Promise.resolve(true);
      }
      if (!isFamilyLocked(view, action) || familyGrantOpen(view, action, Date.now()))
        return Promise.resolve(true);
      return open === null ? Promise.resolve(false) : open({ action, options });
    },
  };
}

export function FamilyProvider({ children }: { readonly children: ReactNode }) {
  const view = useFamilyView();
  const [pending, setPending] = useState<Pending | null>(null);

  // The engine is the truth: ask on mount and whenever this window comes back to the front
  // (a parent may have changed it from another device).
  // Arriving from Advanced mode with "Switch" / "Done — hand back" chosen there (see handoff.ts).
  useEffect(() => {
    consumeHandoff(window.location, (url) => window.history.replaceState(null, "", url), {
      lock: () => void lockFamilyGrants(),
      endSession: endGrownUpSession,
      openPicker: openChildPicker,
    });
  }, []);

  useEffect(() => {
    void refreshFamily();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshFamily();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    if (!view.enabled || view.me.kind !== "shared") return;
    const expiresAt = Math.max(
      view.openUntil.grownUpSession ?? 0,
      view.openUntil.settings ?? 0,
      view.openUntil.advanced ?? 0,
    );
    const delay = expiresAt - Date.now();
    if (delay <= 0) return;
    const timer = window.setTimeout(() => void refreshFamily(), delay + 50);
    return () => window.clearTimeout(timer);
  }, [view.enabled, view.me.kind, view.openUntil.settings, view.openUntil.advanced]);

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
      <GrownUpModeBar view={view} />
      {pending ? (
        <ParentCodeSheet
          key={`${pending.action}:${pending.options.requestId ?? ""}`}
          pending={pending}
        />
      ) : null}
    </FamilyContext.Provider>
  );
}

const readBarClock = () => Math.round(Date.now() / 60_000) * 60_000;
const subscribeBarClock = (onChange: () => void) => {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
};

function GrownUpModeBar({ view }: { readonly view: FamilyView }) {
  const now = useSyncExternalStore(subscribeBarClock, readBarClock, readBarClock);
  const minutes = grownUpMinutesLeft(view, now);
  if (
    !view.enabled ||
    view.me.kind !== "shared" ||
    minutes === 0 ||
    grownUpSessionFor(readGrownUpSessionId(), view, now) === null
  ) {
    return null;
  }
  return (
    <div className="fm-grown-up-bar" role="status">
      <span>Grown-up mode · {minutes} min</span>
      {minutes <= 2 ? (
        <Button size="sm" onClick={() => void renewGrownUpSession()}>
          Stay
        </Button>
      ) : null}
      <Button
        size="sm"
        onClick={() => {
          void lockFamilyGrants();
          const childId = grownUpReturnChild();
          clearGrownUpReturnChild();
          endGrownUpSession();
          if (childId !== null && view.children.some((child) => child.id === childId)) {
            void chooseChild(childId);
          } else {
            openChildPicker();
          }
        }}
      >
        Done
      </Button>
    </div>
  );
}

/** Outside the provider (tests, isolated mounts) the profile still reads; the sheet cannot open. */
export function useFamily(): FamilyApi {
  const context = useContext(FamilyContext);
  const view = useFamilyView();
  return context ?? makeApi(view, null);
}

/**
 * How the child using SKYCOT here has their steps run while the profile is on: safe steps by
 * themselves, or (their parent's choice) asked before each step. Null while the profile is off.
 */
export function useFamilySteps():
  | (ReturnType<typeof familySteps> & { readonly askEachStep: boolean })
  | null {
  const view = useFamilyView();
  if (!familyOn(view)) return null;
  const ask = asksEachStep(view);
  return { ...familySteps(ask), askEachStep: ask };
}

function ParentCodeSheet({ pending }: { readonly pending: Pending }) {
  const view = useFamilyView();
  const entry = useParentCodeEntry(attemptFor(pending.action, pending.options), () => {
    if (
      view.me.kind === "shared" &&
      pending.action !== "approve" &&
      pending.action !== "deleteConversation" &&
      pending.action !== "restartToUpdate" &&
      view.grownUps[0] !== undefined
    )
      startGrownUpSession(view.grownUps[0].id, view.currentChildId);
    pending.resolve(true);
  });
  const cancel = () => pending.resolve(false);
  return (
    <Sheet
      open
      onClose={cancel}
      icon={KeyRound}
      iconTone="grey"
      title={
        pending.action === "approve"
          ? "Ask a grown-up"
          : pending.action === "deleteConversation"
            ? "Delete with the parent code"
            : "Parent code"
      }
      description={actionReason(pending.action, pending.options.reason)}
      sober
      initialFocus="first"
      actions={
        <>
          <Button onClick={cancel} disabled={entry.busy}>
            Cancel
          </Button>
          {pending.action === "deleteConversation" ? (
            <Button
              variant="destructive"
              filled
              disabled={!entry.canSubmit}
              onClick={() => void entry.submit()}
            >
              {entry.busy ? "Checking…" : "Delete"}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!entry.canSubmit}
              onClick={() => void entry.submit()}
            >
              {entry.busy ? "Checking…" : pending.action === "approve" ? "Allow" : "Continue"}
            </Button>
          )}
        </>
      }
    >
      <ParentCodeEntry entry={entry} autoFocus />
    </Sheet>
  );
}
