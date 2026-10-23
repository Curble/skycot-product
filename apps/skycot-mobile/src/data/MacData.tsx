/**
 * What each linked Mac says right now, kept fresh while the app is open.
 *
 * Every Mac is asked for its Family status (who this device is, the children, today's limits);
 * a child's device also reads its conversation list, a grown-up's phone its waiting requests
 * and each child's day. Nothing is asked while the app is in the background: real nudges come
 * with SKYCOT Relay's notifications (Phase 2). A child's device tells its Mac it is in use
 * (the heartbeat the plain client sends, so today's minutes count the same way).
 */
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";

import { familyApi, type PendingRequest, type ServerFamilyStatus, type Today } from "../family/api";
import { codeLengthOf, sharedCodeLength } from "../family/codeLength";
import { readShell } from "../engine/engine";
import type { ShellSnapshot } from "../engine/types";
import { useLinks, type Mac } from "../links/store";

export interface MacState {
  readonly status: ServerFamilyStatus | null;
  readonly shell: ShellSnapshot | null;
  readonly requests: ReadonlyArray<PendingRequest> | null;
  readonly today: Today | null;
  /** The engine's own sentence when the last read failed. */
  readonly problem: string | null;
  /** The Mac said this device isn't linked any more (removed there, or signed out). */
  readonly signedOut: boolean;
  readonly reachable: boolean;
}

const EMPTY: MacState = {
  status: null,
  shell: null,
  requests: null,
  today: null,
  problem: null,
  signedOut: false,
  reachable: true,
};

interface MacDataValue {
  readonly byMac: Readonly<Record<string, MacState>>;
  readonly refresh: (macId?: string) => Promise<void>;
  /** Marks a touch, so the heartbeat counts this minute as active use. */
  readonly touched: () => void;
}

const MacDataContext = createContext<MacDataValue | null>(null);

const STATUS_MS = 15_000;
const SHELL_MS = 4_000;
const REQUESTS_MS = 5_000;
const TODAY_MS = 60_000;
const HEARTBEAT_MS = 30_000;
const ACTIVE_WINDOW_MS = 120_000;

function signedOutReason(reason: string): boolean {
  return reason === "unauthenticated" || reason === "removed";
}

export function MacDataProvider(props: { readonly children: ReactNode }) {
  const { macs, mode } = useLinks();
  const [byMac, setByMac] = useState<Record<string, MacState>>({});
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const lastTouch = useRef(Date.now());

  const patch = useCallback((macId: string, next: Partial<MacState>) => {
    setByMac((current) => ({ ...current, [macId]: { ...(current[macId] ?? EMPTY), ...next } }));
  }, []);

  const readStatus = useCallback(
    async (mac: Mac) => {
      const result = await familyApi.status(mac.transport);
      if (result.ok)
        patch(mac.macId, {
          status: result.value,
          problem: null,
          signedOut: false,
          reachable: true,
        });
      else
        patch(mac.macId, {
          problem: result.message,
          signedOut: signedOutReason(result.reason),
          reachable: result.reason !== "unreachable",
        });
    },
    [patch],
  );

  const readShellFor = useCallback(
    async (mac: Mac) => {
      try {
        patch(mac.macId, { shell: await readShell(mac.transport), reachable: true });
      } catch {
        patch(mac.macId, { reachable: false });
      }
    },
    [patch],
  );

  const readRequests = useCallback(
    async (mac: Mac) => {
      const result = await familyApi.pendingRequests(mac.transport);
      if (result.ok) patch(mac.macId, { requests: result.value, reachable: true });
      else patch(mac.macId, { reachable: result.reason !== "unreachable" });
    },
    [patch],
  );

  const readToday = useCallback(
    async (mac: Mac) => {
      const result = await familyApi.today(mac.transport);
      if (result.ok) patch(mac.macId, { today: result.value });
    },
    [patch],
  );

  const refresh = useCallback(
    async (macId?: string) => {
      const targets = macId === undefined ? macs : macs.filter((mac) => mac.macId === macId);
      await Promise.all(
        targets.flatMap((mac) => [
          readStatus(mac),
          readToday(mac),
          mode === "child" ? readShellFor(mac) : readRequests(mac),
          ...(mode === "grown-up" ? [readShellFor(mac)] : []),
        ]),
      );
    },
    [macs, mode, readStatus, readShellFor, readRequests, readToday],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setForeground(state === "active");
      if (state === "active") lastTouch.current = Date.now();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!foreground || macs.length === 0) return;
    void refresh();
    const timers = [
      setInterval(() => macs.forEach((mac) => void readStatus(mac)), STATUS_MS),
      setInterval(() => macs.forEach((mac) => void readToday(mac)), TODAY_MS),
      mode === "child"
        ? setInterval(() => macs.forEach((mac) => void readShellFor(mac)), SHELL_MS)
        : setInterval(() => macs.forEach((mac) => void readRequests(mac)), REQUESTS_MS),
    ];
    if (mode === "grown-up") {
      timers.push(setInterval(() => macs.forEach((mac) => void readShellFor(mac)), STATUS_MS));
    }
    if (mode === "child") {
      const beat = () =>
        macs.forEach((mac) => {
          const active = Date.now() - lastTouch.current < ACTIVE_WINDOW_MS;
          void familyApi.heartbeat(mac.transport, active).then((result) => {
            if (result.ok) {
              setByMac((current) => {
                const state = current[mac.macId] ?? EMPTY;
                if (state.status === null) return current;
                return {
                  ...current,
                  [mac.macId]: { ...state, status: { ...state.status, session: result.value } },
                };
              });
            }
          });
        });
      beat();
      timers.push(setInterval(beat, HEARTBEAT_MS));
    }
    return () => timers.forEach(clearInterval);
  }, [foreground, macs, mode, refresh, readStatus, readShellFor, readRequests, readToday]);

  const value = useMemo<MacDataValue>(
    () => ({ byMac, refresh, touched: () => (lastTouch.current = Date.now()) }),
    [byMac, refresh],
  );
  return <MacDataContext value={value}>{props.children}</MacDataContext>;
}

export function useMacData(): MacDataValue {
  const value = use(MacDataContext);
  if (value === null) throw new Error("useMacData outside MacDataProvider");
  return value;
}

export function useMacState(macId: string): MacState {
  return useMacData().byMac[macId] ?? EMPTY;
}

/**
 * How many digits this Mac's parent code has, for the code box to take it on the last digit.
 * Null on a child's device (the Mac never tells one), before the Mac said, or outside the
 * provider: the box then waits for its button.
 */
export function useCodeLength(macId: string | null | undefined): number | null {
  const value = use(MacDataContext);
  if (value === null || macId === null || macId === undefined) return null;
  return codeLengthOf(value.byMac[macId]?.status);
}

/** The same for one code sent to several Macs: known only when they all say the same. */
export function useSharedCodeLength(macIds: ReadonlyArray<string>): number | null {
  const value = use(MacDataContext);
  if (value === null) return null;
  return sharedCodeLength(macIds.map((macId) => value.byMac[macId]?.status));
}
