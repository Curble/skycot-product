// `useFamily()`: the profile, which actions it locks, and `requireParentCode`,
// which opens the code sheet over whatever is on screen and resolves with
// whether the parent proved it. The provider lives once, above the shell, so a
// sheet opened from inside another sheet still stacks correctly (ui/useModal).
import { KeyRound } from "lucide-react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { actionReason } from "./copy";
import { isFamilyLocked, type FamilyAction, type FamilyProfile } from "./family";
import { ParentCodeEntry, useParentCodeEntry } from "./ParentCodeEntry";
import { useFamilyProfile } from "./store";

export interface FamilyApi {
  readonly profile: FamilyProfile;
  readonly enabled: boolean;
  readonly isLocked: (action: FamilyAction) => boolean;
  /** Resolves true at once when the action is not locked; otherwise after the sheet. */
  readonly requireParentCode: (action: FamilyAction) => Promise<boolean>;
}

interface Pending {
  readonly action: FamilyAction;
  readonly resolve: (ok: boolean) => void;
}

const FamilyContext = createContext<FamilyApi | null>(null);

export function FamilyProvider({ children }: { readonly children: ReactNode }) {
  const profile = useFamilyProfile();
  const [pending, setPending] = useState<Pending | null>(null);

  const api = useMemo<FamilyApi>(
    () => ({
      profile,
      enabled: profile.enabled,
      isLocked: (action) => isFamilyLocked(profile, action),
      requireParentCode: (action) => {
        if (!isFamilyLocked(profile, action)) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
          setPending({
            action,
            resolve: (ok) => {
              setPending(null);
              resolve(ok);
            },
          });
        });
      },
    }),
    [profile],
  );

  return (
    <FamilyContext.Provider value={api}>
      {children}
      {pending ? <ParentCodeSheet key={pending.action} pending={pending} /> : null}
    </FamilyContext.Provider>
  );
}

/** Outside the provider (tests, isolated mounts) the profile still reads; the sheet cannot open. */
export function useFamily(): FamilyApi {
  const context = useContext(FamilyContext);
  const profile = useFamilyProfile();
  if (context) return context;
  return {
    profile,
    enabled: profile.enabled,
    isLocked: (action) => isFamilyLocked(profile, action),
    requireParentCode: (action) => Promise.resolve(!isFamilyLocked(profile, action)),
  };
}

function ParentCodeSheet({ pending }: { readonly pending: Pending }) {
  const entry = useParentCodeEntry(() => pending.resolve(true));
  const cancel = () => pending.resolve(false);
  return (
    <Sheet
      open
      onClose={cancel}
      icon={KeyRound}
      iconTone="grey"
      title="Parent code"
      description={actionReason(pending.action)}
      sober
      initialFocus="first"
      actions={
        <>
          <Button onClick={cancel} disabled={entry.busy}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!entry.canSubmit} onClick={() => void entry.submit()}>
            {entry.busy ? "Checking…" : "Continue"}
          </Button>
        </>
      }
    >
      <ParentCodeEntry entry={entry} />
    </Sheet>
  );
}
