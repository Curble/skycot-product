import { useNavigate } from "@tanstack/react-router";
import { DownloadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { APP_BASE_NAME } from "~/branding"; // nondev-seam: skycot-no-provider-update-prompt
import { useStableCallback } from "~/hooks/useStableCallback";
import { useEnvironments } from "~/state/environments";
import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";
import { useDismissedProviderUpdateNotificationKeys } from "../providerUpdateDismissal";
import { ProviderUpdateEnvironmentRows } from "./ProviderUpdateEnvironmentRows";
import { useLocalEnvironmentUpdateGroups } from "./ProviderUpdateLaunchNotification.environments";
import {
  collectProviderUpdateCandidates,
  environmentGroupsWithUpdates,
  getProviderUpdateInitialToastView,
  localEnvironmentUpdateNotificationKey,
} from "./ProviderUpdateLaunchNotification.logic";
import { ProviderUpdatePrimaryNotification } from "./ProviderUpdatePrimaryNotification";
import { shouldShowProviderUpdatePrompt } from "./skycotProviderUpdatePrompt";
import { stackedThreadToast, toastManager } from "./ui/toast";

function useHasLocalSecondaryEnvironment(): boolean {
  const { environments } = useEnvironments();
  return environments.some((environment) =>
    isDesktopLocalConnectionTarget(environment.entry.target),
  );
}

export function ProviderUpdateLaunchNotification() {
  // nondev-seam: skycot-no-provider-update-prompt
  // SKYCOT installs and updates approved add-ons through its own family flow, so a parent never
  // sees a vendor "Updates Available" pop-up. Settings > Providers still updates by hand.
  // The brand is fixed for the life of the build, so the hook order never changes.
  if (!shouldShowProviderUpdatePrompt(APP_BASE_NAME)) return null;
  return <ProviderUpdateLaunchPrompt />;
}

function ProviderUpdateLaunchPrompt() {
  const hasLocalSecondary = useHasLocalSecondaryEnvironment();

  return hasLocalSecondary ? (
    <ProviderUpdateEnvironmentsNotification />
  ) : (
    <ProviderUpdatePrimaryNotification />
  );
}

const seenProviderUpdateNotificationKeys = new Set<string>();
type ProviderUpdateToastId = ReturnType<typeof toastManager.add>;

// While a local backend (e.g. WSL) is still connecting, defer the popover so it
// reflects every environment. Cap the wait so a stuck or failed backend can't
// suppress the primary's updates indefinitely.
const SETTLING_GRACE_MS = 30_000;

function ProviderUpdateEnvironmentsNotification() {
  const navigate = useNavigate();
  const { groups, isAnySettling } = useLocalEnvironmentUpdateGroups();
  const { dismissedNotificationKeys, dismissNotificationKey } =
    useDismissedProviderUpdateNotificationKeys();

  const activeToastRef = useRef<{
    readonly toastId: ProviderUpdateToastId;
    readonly key: string;
  } | null>(null);
  // Whether the user has triggered an update from the current toast. Until they
  // do, the prompt is replaced when the available updates change; afterward it
  // is kept so in-progress rows are not torn down.
  const hasInteractedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (activeToastRef.current !== null) {
        toastManager.close(activeToastRef.current.toastId);
        activeToastRef.current = null;
      }
    };
  }, []);

  const updateGroups = environmentGroupsWithUpdates(groups);
  const notificationKey = localEnvironmentUpdateNotificationKey(groups);
  const candidateUnion = collectProviderUpdateCandidates(
    updateGroups.flatMap((group) => group.candidates),
  );

  const [settleGraceElapsed, setSettleGraceElapsed] = useState(false);
  // The grace period restarts with the next settling phase.
  if (!isAnySettling && settleGraceElapsed) {
    setSettleGraceElapsed(false);
  }
  useEffect(() => {
    if (!isAnySettling) return;
    const timer = setTimeout(() => setSettleGraceElapsed(true), SETTLING_GRACE_MS);
    return () => clearTimeout(timer);
  }, [isAnySettling]);
  const isGated = isAnySettling && !settleGraceElapsed;

  const openProviderSettings = () => {
    const active = activeToastRef.current;
    if (active !== null) {
      toastManager.close(active.toastId);
      activeToastRef.current = null;
    }
    void navigate({ to: "/settings/providers" });
  };

  // The toast closes long after the effect that opened it, so it dismisses the key
  // the updates have moved to by then.
  const dismissPrompt = useStableCallback(() => {
    if (notificationKey) {
      dismissNotificationKey(notificationKey);
    }
    activeToastRef.current = null;
  });

  useEffect(() => {
    const canShowPrompt =
      notificationKey !== null &&
      !isGated &&
      !dismissedNotificationKeys.has(notificationKey) &&
      !seenProviderUpdateNotificationKeys.has(notificationKey);

    const active = activeToastRef.current;
    if (
      active &&
      active.key !== notificationKey &&
      !hasInteractedRef.current &&
      (notificationKey === null || !isGated)
    ) {
      toastManager.close(active.toastId);
      activeToastRef.current = null;
    }

    if (!notificationKey || !canShowPrompt || activeToastRef.current !== null) {
      return;
    }

    seenProviderUpdateNotificationKeys.add(notificationKey);
    hasInteractedRef.current = false;

    const toastId = toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: getProviderUpdateInitialToastView({
          updateProviders: candidateUnion,
          oneClickProviders: candidateUnion,
        }).title,
        description: (
          <ProviderUpdateEnvironmentRows
            onInteract={() => {
              hasInteractedRef.current = true;
            }}
          />
        ),
        timeout: 0,
        actionProps: {
          children: "Settings",
          onClick: openProviderSettings,
        },
        actionVariant: "outline",
        data: {
          hideCopyButton: true,
          leadingIcon: <DownloadIcon aria-hidden="true" className="size-4 text-success" />,
          onClose: dismissPrompt,
        },
      }),
    );
    activeToastRef.current = { toastId, key: notificationKey };
  }, [
    notificationKey,
    isGated,
    candidateUnion,
    dismissedNotificationKeys,
    dismissPrompt,
    openProviderSettings,
  ]);

  return null;
}
