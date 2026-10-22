import type { ServerProvider } from "@t3tools/contracts";
import { X } from "lucide-react";
import { useState } from "react";

import { describeProviderUsage, usageWarning } from "../../plain/usage";
import { Banner } from "../../ui/Banner";
import { Button, IconButton } from "../../ui/Button";
import { useFamily } from "../family/FamilyProvider";
import { localTimeZone, openUsageSheet, useActiveUsage } from "./useUsage";

const DISMISSED_KEY = "skycot:usageWarningDismissed";

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(key: string): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, key);
  } catch {
    // Storage blocked: the banner just comes back next time.
  }
}

/**
 * A calm, one-time heads-up once the assistant in use has 20% or less of an allowance left.
 * It never blocks work. Dismissed (or opened) it stays away until that allowance resets, when
 * the warning's key changes.
 */
export function UsageBanner() {
  const family = useFamily();
  const { active } = useActiveUsage();
  if (family.enabled || active === null) return null;
  // Remounted per limits snapshot, so "resets in 12 minutes" is measured from when it arrived.
  return (
    <WarningFor key={`${active.instanceId}:${active.usageLimits?.checkedAt}`} active={active} />
  );
}

function WarningFor({ active }: { readonly active: ServerProvider }) {
  const [now] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(readDismissed);
  const warning = usageWarning(
    describeProviderUsage(active, now, localTimeZone()),
    active.usageLimits,
  );
  if (warning === null || warning.key === dismissed) return null;
  const dismiss = () => {
    writeDismissed(warning.key);
    setDismissed(warning.key);
  };
  return (
    <Banner
      tone="warning"
      action={
        <span className="fm-usage-banner__actions">
          <Button
            size="sm"
            onClick={() => {
              dismiss();
              openUsageSheet();
            }}
          >
            Details
          </Button>
          <IconButton icon={X} label="Dismiss" size="sm" onClick={dismiss} />
        </span>
      }
    >
      {warning.text}
    </Banner>
  );
}
