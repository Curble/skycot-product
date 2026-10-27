// nondev-seam: skycot-iphone-q47-notification-consent
/**
 * Real notifications when SKYCOT is closed: "SKYCOT needs a grown-up" on a grown-up's phone
 * (and their Apple Watch, which iOS forwards it to) and "Sam has finished" on a child's device.
 *
 * iOS gives this app a push token (modules/skycot-watch, `registerForPush`); this hands it to
 * each linked Mac through its SKYCOT Relay tunnel (RelayHome.registerPush). The relay seals it
 * into a reference only it can open; the Mac keeps the reference for this device and asks the
 * relay for a content-free notification when a request appears or a child's turn finishes
 * (apps/server/src/skycot/relay/SkycotRelay.ts). Macs linked without the relay get no pushes;
 * while SKYCOT is open it still shows its own notifications (src/watch/WatchBridge.tsx).
 *
 * Runs at launch, when the linked Macs change and each time SKYCOT comes back to the front, so
 * a new token (iOS changes it rarely) or a Mac that was asleep is caught up.
 */
import * as SecureStore from "expo-secure-store";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import type { RelayHome } from "@t3tools/skycot-relay/client/home";

import { SkycotWatch } from "../../modules/skycot-watch";
import { useLinks } from "../links/store";
import {
  homesToRegister,
  parseRegistered,
  registrationKey,
  stillRegistered,
  type PushHome,
} from "./plan";

const REGISTERED_KEY = "skycot.push.v1";
const KEYCHAIN = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } as const;
/** The Mac may be asleep: one try per Mac per pass, then the next pass tries again. */
const REGISTER_TIMEOUT_MS = 45_000;

interface Home extends PushHome {
  readonly relay: RelayHome;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export function PushRegistration(): null {
  const { ready, macs, mode } = useLinks();
  const [pass, setPass] = useState(0);
  const running = useRef<Promise<void>>(Promise.resolve());

  const homes = useMemo<ReadonlyArray<Home>>(
    () =>
      macs.flatMap((mac) =>
        mac.relay === null || mac.relayRecord === null
          ? []
          : [
              {
                macId: mac.macId,
                homeId: mac.relayRecord.homeId,
                deviceRelayId: mac.relayRecord.deviceRelayId,
                relay: mac.relay,
              },
            ],
      ),
    [macs],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setPass((count) => count + 1);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const native = SkycotWatch;
    if (native === null || !ready || mode === "unlinked" || homes.length === 0) return;
    // One pass at a time, so the same token is never handed to a Mac twice at once.
    running.current = running.current.then(async () => {
      // A child's device asks here; a grown-up's phone asks once its requests have loaded
      // (WatchBridge), so the question comes with the requests on the screen. Asking twice is
      // harmless: iOS asks the person once.
      const token = await native.registerForPush().catch(() => null);
      if (token === null) return;
      const before = parseRegistered(
        await SecureStore.getItemAsync(REGISTERED_KEY, KEYCHAIN).catch(() => null),
      );
      const kept = stillRegistered(homes, token, before);
      for (const home of homesToRegister(homes, token, kept)) {
        const handed = await withTimeout(
          home.relay.registerPush({
            token: token.token,
            type: "alert",
            environment: token.environment,
          }),
          REGISTER_TIMEOUT_MS,
          false,
        );
        if (handed) kept.add(registrationKey(home, token));
        else if (__DEV__) {
          console.warn("[skycot] push token not handed to", home.macId, "yet");
        }
      }
      await SecureStore.setItemAsync(REGISTERED_KEY, JSON.stringify([...kept]), KEYCHAIN).catch(
        () => undefined,
      );
    });
  }, [ready, mode, homes, pass]);

  return null;
}
