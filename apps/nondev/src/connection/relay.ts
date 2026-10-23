// A linked phone or iPad opening SKYCOT away from home (Phase 2, docs/nondev/RELAY.md).
//
// The page then comes from SKYCOT's own web address, not from the family's Mac, so before the
// app starts this file decides whether it talks to a home Mac through SKYCOT Relay:
//
// 1. A link from the Mac's QR code carries the relay part after `#` (link.ts). It is read once,
//    this browser makes its own tunnel key for that Mac, and the record is kept here. The
//    one-time code stays in the address, so the usual pairing screen exchanges it, through the
//    tunnel, for this device's sign-in.
// 2. Every later visit finds the record and routes the engine's API (fetch and WebSocket) to the
//    Mac through the tunnel (client/shim.ts). The rest of the app does not know.
//
// Several Macs: each link adds its Mac; one is active at a time in a browser (the iOS app shows
// them side by side in Phase 3). A record lives in this browser's storage only, like the session
// cookie it replaces.

import {
  newHomeRecord,
  RelayHome,
  type HomeRecord,
  type HomeStatus,
} from "@t3tools/skycot-relay/client/home";
import { installRelayShim } from "@t3tools/skycot-relay/client/shim";
import { parseRelayLink } from "@t3tools/skycot-relay/link";

const STORAGE_KEY = "skycot:relay-homes";

interface StoredHome {
  readonly record: HomeRecord;
  /** The page address this home is used from (a home is never used from the Mac's own page). */
  readonly appOrigin: string;
  readonly addedAt: number;
}

interface StoredHomes {
  readonly version: 1;
  readonly active: string | null;
  readonly homes: Readonly<Record<string, StoredHome>>;
}

const EMPTY: StoredHomes = { version: 1, active: null, homes: {} };

function load(): StoredHomes {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY;
    const parsed = JSON.parse(raw) as StoredHomes;
    return parsed && parsed.version === 1 && typeof parsed.homes === "object" ? parsed : EMPTY;
  } catch {
    return EMPTY;
  }
}

function store(homes: StoredHomes): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(homes));
  } catch {
    // Storage blocked (a private window): the tunnel still works until the tab closes.
  }
}

let active: RelayHome | null = null;
const listeners = new Set<(status: HomeStatus) => void>();

/** The tunnel to the active home Mac, when this page uses one. */
export function relayHome(): RelayHome | null {
  return active;
}

export function onRelayStatus(listener: (status: HomeStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The home Macs this browser knows, for a "Your Macs" list. */
export function relayHomes(): ReadonlyArray<{
  readonly homeId: string;
  readonly label: string | null;
  readonly active: boolean;
}> {
  const homes = load();
  return Object.values(homes.homes)
    .filter((home) => home.appOrigin === window.location.origin)
    .map((home) => ({
      homeId: home.record.homeId,
      label: home.record.label,
      active: home.record.homeId === homes.active,
    }));
}

export function switchRelayHome(homeId: string): void {
  const homes = load();
  if (homes.homes[homeId] === undefined) return;
  store({ ...homes, active: homeId });
  window.location.reload();
}

/** Unlink this browser from one Mac (the Mac's own Remove is what ends its sign-in). */
export function forgetRelayHome(homeId: string): void {
  const homes = load();
  const { [homeId]: _gone, ...rest } = homes.homes;
  store({
    version: 1,
    active: homes.active === homeId ? (Object.keys(rest)[0] ?? null) : homes.active,
    homes: rest,
  });
}

/**
 * Runs before the app loads. Returns true when this page now talks to its Mac through the relay.
 */
export function startRelayIfLinked(): boolean {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return false;
  let homes = load();
  const link = parseRelayLink(window.location.hash);
  if (link !== null) {
    const existing = homes.homes[link.homeId];
    const record =
      existing !== undefined && existing.record.deviceRelayId === link.deviceRelayId
        ? existing.record
        : newHomeRecord(link);
    homes = {
      version: 1,
      active: link.homeId,
      homes: {
        ...homes.homes,
        [link.homeId]: { record, appOrigin: window.location.origin, addedAt: Date.now() },
      },
    };
    store(homes);
    // Keep only the one-time code in the address: the pairing screen reads it from there and
    // strips it; the keys and pass never stay in the address bar or the history.
    const hash =
      link.token === null ? "#/" : `#${new URLSearchParams([["token", link.token]]).toString()}`;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
  }
  const chosen = homes.active === null ? undefined : homes.homes[homes.active];
  if (chosen === undefined || chosen.appOrigin !== window.location.origin) return false;
  const homeId = chosen.record.homeId;
  active = new RelayHome({
    record: chosen.record,
    save: (record) => {
      const current = load();
      const entry = current.homes[homeId];
      if (entry === undefined) return;
      store({ ...current, homes: { ...current.homes, [homeId]: { ...entry, record } } });
    },
    onStatus: (status) => {
      for (const listener of listeners) listener(status);
    },
  });
  installRelayShim(window, active);
  return true;
}
