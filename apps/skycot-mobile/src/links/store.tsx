/**
 * The Macs this device is linked to. The list (names, addresses, who this device is on each)
 * and each Mac's sign-in live in the iOS keychain, on this device only
 * (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`: not in backups, not on another iPhone).
 */
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { HomeRecord } from "@t3tools/skycot-relay/client/home";

import type { MacTransport } from "../transport/MacTransport";
import { closeRelayHome, relayHomeFor, waysToMac } from "../transport/ways";
import { acceptsLink, modeOf, type DeviceMode, type LinkedMac, type MacLink } from "./pairing";

const LIST_KEY = "skycot.links.v1";
const tokenKey = (macId: string) => `skycot.token.${macId.replace(/[^A-Za-z0-9._-]/gu, "_")}`;
const relayKey = (macId: string) => `skycot.relay.${macId.replace(/[^A-Za-z0-9._-]/gu, "_")}`;
const KEYCHAIN = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } as const;

/** The tunnel's record changes (cookies, a renewed pass): kept in the keychain too. */
function saveRelayRecord(macId: string, record: HomeRecord): void {
  void SecureStore.setItemAsync(relayKey(macId), JSON.stringify(record), KEYCHAIN).catch(
    () => undefined,
  );
}

function parseRelayRecord(raw: string | null): HomeRecord | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as HomeRecord;
    return typeof value.homeId === "string" && typeof value.relayUrl === "string" ? value : null;
  } catch {
    return null;
  }
}

export interface Mac extends LinkedMac {
  readonly transport: MacTransport;
}

interface LinksState {
  readonly ready: boolean;
  readonly macs: ReadonlyArray<Mac>;
  readonly mode: DeviceMode;
  /** False when the new Mac disagrees with the others about what this device is. */
  readonly add: (linked: LinkedMac) => Promise<boolean>;
  readonly forget: (macId: string) => Promise<void>;
}

const LinksContext = createContext<LinksState | null>(null);

function parseList(raw: string | null): Array<MacLink> {
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? (value as Array<MacLink>) : [];
  } catch {
    return [];
  }
}

function withTransport(link: LinkedMac): Mac {
  const relay =
    link.relayRecord === null
      ? null
      : relayHomeFor(link.relayRecord, (record) => saveRelayRecord(link.macId, record));
  return {
    ...link,
    transport: waysToMac({ httpBaseUrl: link.httpBaseUrl, bearerToken: link.bearerToken, relay }),
  };
}

export function LinksProvider(props: { readonly children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [macs, setMacs] = useState<ReadonlyArray<Mac>>([]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const list = parseList(await SecureStore.getItemAsync(LIST_KEY, KEYCHAIN).catch(() => null));
      const loaded: Array<Mac> = [];
      for (const link of list) {
        const token = await SecureStore.getItemAsync(tokenKey(link.macId), KEYCHAIN).catch(
          () => null,
        );
        const relayRecord = parseRelayRecord(
          await SecureStore.getItemAsync(relayKey(link.macId), KEYCHAIN).catch(() => null),
        );
        if (token !== null)
          loaded.push(withTransport({ ...link, bearerToken: token, relayRecord }));
      }
      if (live) {
        setMacs(loaded);
        setReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const save = useCallback(async (next: ReadonlyArray<Mac>) => {
    const list: Array<MacLink> = next.map(({ macId, macName, httpBaseUrl, me, linkedAt }) => ({
      macId,
      macName,
      httpBaseUrl,
      me,
      linkedAt,
    }));
    await SecureStore.setItemAsync(LIST_KEY, JSON.stringify(list), KEYCHAIN);
  }, []);

  const add = useCallback(
    async (linked: LinkedMac) => {
      if (!acceptsLink(macs, linked)) return false;
      await SecureStore.setItemAsync(tokenKey(linked.macId), linked.bearerToken, KEYCHAIN);
      if (linked.relayRecord !== null) saveRelayRecord(linked.macId, linked.relayRecord);
      else
        await SecureStore.deleteItemAsync(relayKey(linked.macId), KEYCHAIN).catch(() => undefined);
      const next = [...macs.filter((mac) => mac.macId !== linked.macId), withTransport(linked)];
      await save(next);
      setMacs(next);
      return true;
    },
    [macs, save],
  );

  const forget = useCallback(
    async (macId: string) => {
      await SecureStore.deleteItemAsync(tokenKey(macId), KEYCHAIN).catch(() => undefined);
      await SecureStore.deleteItemAsync(relayKey(macId), KEYCHAIN).catch(() => undefined);
      const gone = macs.find((mac) => mac.macId === macId);
      if (gone?.relayRecord) closeRelayHome(gone.relayRecord.homeId);
      const next = macs.filter((mac) => mac.macId !== macId);
      await save(next);
      setMacs(next);
    },
    [macs, save],
  );

  const value = useMemo<LinksState>(
    () => ({ ready, macs, mode: modeOf(macs), add, forget }),
    [ready, macs, add, forget],
  );
  return <LinksContext value={value}>{props.children}</LinksContext>;
}

export function useLinks(): LinksState {
  const value = use(LinksContext);
  if (value === null) throw new Error("useLinks outside LinksProvider");
  return value;
}
