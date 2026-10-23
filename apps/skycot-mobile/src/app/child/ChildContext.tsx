/**
 * Who this child is on each linked Mac, and what each Mac can run. A child's device is always
 * that child: no picker, no switching to a brother or sister (WHO-IS-WHO).
 */
import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react";

import type { FamilyChild } from "../../../../nondev/src/features/family/children";
import { useMacData } from "../../data/MacData";
import { readMacConfig, type MacConfig } from "../../engine/engine";
import type { SessionLimits } from "../../family/api";
import { useLinks, type Mac } from "../../links/store";

interface ChildValue {
  readonly macs: ReadonlyArray<Mac>;
  /** The child's name on the first Mac that knows it. */
  readonly name: string | null;
  readonly childOn: (mac: Mac) => FamilyChild | null;
  readonly sessionOn: (mac: Mac) => SessionLimits | null;
  readonly configs: Readonly<Record<string, MacConfig | null>>;
  readonly questionsRoots: Readonly<Record<string, string | null>>;
  readonly timeZoneOn: (mac: Mac) => string;
}

const ChildContext = createContext<ChildValue | null>(null);

export function ChildProvider(props: { readonly children: ReactNode }) {
  const { macs } = useLinks();
  const { byMac } = useMacData();
  const [configs, setConfigs] = useState<Record<string, MacConfig | null>>({});

  useEffect(() => {
    let live = true;
    for (const mac of macs) {
      if (configs[mac.macId] !== undefined) continue;
      void readMacConfig(mac.transport)
        .then((config) => live && setConfigs((current) => ({ ...current, [mac.macId]: config })))
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [macs, configs]);

  const value = useMemo<ChildValue>(() => {
    const childOn = (mac: Mac) => {
      const status = byMac[mac.macId]?.status;
      if (status === null || status === undefined || mac.me.kind !== "child") return null;
      const childId = mac.me.childId;
      return status.children.find((child) => child.id === childId) ?? null;
    };
    const name = macs.map(childOn).find((child) => child?.name)?.name ?? null;
    const questionsRoots: Record<string, string | null> = {};
    for (const [macId, config] of Object.entries(configs))
      questionsRoots[macId] = config?.questionsRoot ?? null;
    return {
      macs,
      name,
      childOn,
      sessionOn: (mac) => byMac[mac.macId]?.status?.session ?? null,
      configs,
      questionsRoots,
      timeZoneOn: (mac) => byMac[mac.macId]?.status?.timeZone ?? "UTC",
    };
  }, [macs, byMac, configs]);
  return <ChildContext value={value}>{props.children}</ChildContext>;
}

/** The child's context, or null on a grown-up's phone. */
export function useOptionalChild(): ChildValue | null {
  return use(ChildContext);
}

export function useChild(): ChildValue {
  const value = use(ChildContext);
  if (value === null) throw new Error("useChild outside ChildProvider");
  return value;
}
