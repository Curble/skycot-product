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

import { directTransport, type MacTransport } from "../transport/MacTransport";
import { acceptsLink, modeOf, type DeviceMode, type LinkedMac, type MacLink } from "./pairing";

const LIST_KEY = "skycot.links.v1";
const tokenKey = (macId: string) => `skycot.token.${macId.replace(/[^A-Za-z0-9._-]/gu, "_")}`;
const KEYCHAIN = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } as const;

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
  return {
    ...link,
    transport: directTransport({ httpBaseUrl: link.httpBaseUrl, bearerToken: link.bearerToken }),
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
        if (token !== null) loaded.push(withTransport({ ...link, bearerToken: token }));
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
