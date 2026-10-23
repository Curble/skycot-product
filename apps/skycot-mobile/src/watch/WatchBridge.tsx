/**
 * The phone's half of SKYCOT on Apple Watch (Phase 4). The phone is the grown-up's linked
 * device; the Watch has no sign-in of its own. So the phone:
 *
 * - sends the Watch a small snapshot whenever what it shows changes (src/watch/snapshot.ts);
 * - answers the Watch: a challenge from the Mac for a yes (the Watch signs it with its own key),
 *   the answer itself (submitted exactly as the phone's own Allow once / Decline, through the
 *   Mac's approver routes, once), and "Lock SKYCOT now" (the phone's Lock everything);
 * - posts "Ava needs a grown-up" when a new request appears while SKYCOT runs on the phone,
 *   with Allow once and Decline (Allow once opens the card first: the notification itself is
 *   content-free). Pushes when SKYCOT is closed wait for SKYCOT Relay and Apple's push key.
 *
 * Setting the Watch up ("Say yes from my Apple Watch", This device) asks the parent code once on
 * the phone; the Watch makes its key and signs the Mac's one-use challenge to prove it holds it.
 */
import * as Linking from "expo-linking";
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
import { AppState, Platform, Settings } from "react-native";

import { SkycotWatch, type WatchLinkState } from "../../modules/skycot-watch";
import { useMacData } from "../data/MacData";
import { familyApi } from "../family/api";
import { useLinks, type Mac } from "../links/store";
import {
  parseEnrolReply,
  parseWatchMessage,
  type WatchEnrolRequest,
  type WatchMessage,
  type WatchReply,
} from "./protocol";
import { buildWatchSnapshot, snapshotKey } from "./snapshot";

const NO_WATCH: WatchLinkState = {
  supported: false,
  paired: false,
  installed: false,
  reachable: false,
};

interface WatchValue {
  readonly link: WatchLinkState;
  /** "Mum's Apple Watch", when it may say yes on every linked Mac. */
  readonly watchName: string | null;
  readonly lockedAt: number | null;
  readonly noteLocked: () => void;
  /** Sets the Watch up to say yes; a plain sentence when it couldn't. */
  readonly enrol: (code: string) => Promise<string | null>;
  readonly forget: () => Promise<string | null>;
}

const WatchContext = createContext<WatchValue>({
  link: NO_WATCH,
  watchName: null,
  lockedAt: null,
  noteLocked: () => undefined,
  enrol: async () => "SKYCOT on Apple Watch isn't available here.",
  forget: async () => null,
});

export function useWatch(): WatchValue {
  return use(WatchContext);
}

const NOT_ANSWERED = "Your iPhone couldn't reach the Mac. Try again in a moment.";

/**
 * Development builds only, for the Simulator check (no one to tap): `-skycotTestWatchSetup
 * <parent code>` sets the Watch up as the Apple Watch row's Set up does, once the Watch app is
 * reachable; `-skycotTestQuiet YES` skips asking to show notifications.
 */
function testSetting(key: string): string | null {
  if (!__DEV__ || Platform.OS !== "ios") return null;
  // A launch argument arrives as a string, a number or a boolean ("YES"), as macOS reads it.
  const value: unknown = Settings.get(key);
  if (typeof value === "string") return value.length > 0 ? value : null;
  return typeof value === "number" || value === true ? String(value) : null;
}

export function WatchBridgeProvider(props: { readonly children: ReactNode }) {
  const { macs, mode } = useLinks();
  const { byMac, refresh } = useMacData();
  const [link, setLink] = useState<WatchLinkState>(() => SkycotWatch?.state() ?? NO_WATCH);
  const [lockedAt, setLockedAt] = useState<number | null>(null);
  const macsRef = useRef(macs);
  macsRef.current = macs;

  const snapshot = useMemo(
    () => buildWatchSnapshot({ mode, macs, byMac, lockedAt, now: Date.now() }),
    [mode, macs, byMac, lockedAt],
  );
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const macFor = (macId: string): Mac | null =>
    macsRef.current.find((mac) => mac.macId === macId) ?? null;

  // The snapshot, whenever what the Watch shows changes.
  const key = snapshotKey(snapshot);
  useEffect(() => {
    if (SkycotWatch === null || !link.paired || !link.installed) return;
    try {
      SkycotWatch.updateContext(JSON.stringify(snapshotRef.current));
    } catch (cause) {
      if (__DEV__) console.warn("[skycot] Watch snapshot:", cause);
    }
  }, [key, link.paired, link.installed]);

  const lockEverything = useCallback(async (): Promise<WatchReply> => {
    const results = await Promise.all(
      macsRef.current.map((mac) => familyApi.lockEverything(mac.transport)),
    );
    const failed = results.find((result) => !result.ok);
    if (failed !== undefined && !failed.ok) return { ok: false, sentence: failed.message };
    setLockedAt(Date.now());
    return { ok: true, sentence: "Locked. Every grown-up's yes has ended, on every device." };
  }, []);

  const handle = useCallback(
    async (message: WatchMessage): Promise<WatchReply> => {
      if (message.type === "hello") return { ok: true, snapshot: snapshotRef.current };
      if (mode !== "grown-up") {
        return { ok: false, sentence: "SKYCOT on Apple Watch is for a grown-up's phone." };
      }
      if (message.type === "lock") return lockEverything();
      const mac = macFor(message.macId);
      if (mac === null) return { ok: false, sentence: "That Mac isn't linked to this iPhone now." };
      if (message.type === "challenge") {
        const issued = await familyApi.watchChallenge(mac.transport, message);
        if (!issued.ok) return { ok: false, sentence: issued.message };
        if (issued.value.keyId === null) return { ok: false, sentence: NOT_ANSWERED };
        return {
          ok: true,
          challenge: issued.value.challenge,
          action: issued.value.action,
          keyId: issued.value.keyId,
        };
      }
      // The answer, exactly as the phone's own card sends it: one request, once.
      const result = await familyApi.answerRequest(mac.transport, {
        threadId: message.threadId,
        requestId: message.requestId,
        decision: message.decision,
        fingerprint: message.fingerprint,
        proof: message.proof === null ? null : { type: "watch", ...message.proof },
        ...(message.decision === "decline" ? { via: "watch" as const } : {}),
      });
      if (!result.ok) return { ok: false, sentence: result.message };
      SkycotWatch?.clearRequest(`${mac.macId}:${message.requestId}`);
      setTimeout(() => void refresh(mac.macId), 600);
      return {
        ok: true,
        sentence:
          message.decision === "accept"
            ? "Allowed, this once."
            : "Declined. They see that on their screen.",
      };
    },
    [mode, lockEverything, refresh],
  );

  // The Watch's messages, and the notification's answers.
  useEffect(() => {
    if (SkycotWatch === null) return;
    const watchState = SkycotWatch.addListener("onWatchState", setLink);
    const messages = SkycotWatch.addListener("onWatchMessage", ({ id, json }) => {
      const message = parseWatchMessage(json);
      void (async () => {
        const reply: WatchReply =
          message === null
            ? { ok: false, sentence: "Your iPhone didn't understand that. Update SKYCOT." }
            : await handle(message).catch(() => ({ ok: false, sentence: NOT_ANSWERED }) as const);
        if (id.length > 0) SkycotWatch?.reply(id, JSON.stringify(reply));
      })();
    });
    const answers = SkycotWatch.addListener(
      "onNotificationAnswer",
      ({ id, action, requestKey }) => {
        void (async () => {
          try {
            const [macId, ...rest] = requestKey.split(":");
            const requestId = rest.join(":");
            const mac = macFor(macId ?? "");
            if (action === "decline" && mac !== null) {
              const pending =
                snapshotRef.current.requests.find((request) => request.id === requestKey) ?? null;
              const fresh =
                pending ??
                (await familyApi.pendingRequests(mac.transport).then((result) => {
                  const found = result.ok
                    ? result.value.find((request) => request.requestId === requestId)
                    : undefined;
                  return found === undefined
                    ? null
                    : { threadId: found.threadId, fingerprint: found.fingerprint };
                }));
              if (fresh !== null) {
                await familyApi.answerRequest(mac.transport, {
                  threadId: fresh.threadId,
                  requestId,
                  decision: "decline",
                  fingerprint: fresh.fingerprint,
                  proof: null,
                });
                void refresh(mac.macId);
              }
            } else {
              // Allow once (or a tap): SKYCOT opens on Requests, where the card is.
              await Linking.openURL(Linking.createURL("section/requests"));
            }
          } finally {
            SkycotWatch?.finishNotificationAnswer(id);
          }
        })();
      },
    );
    setLink(SkycotWatch.state());
    return () => {
      watchState.remove();
      messages.remove();
      answers.remove();
    };
  }, [handle, refresh]);

  // "Ava needs a grown-up": once for each new request, while SKYCOT runs on the phone.
  const told = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (SkycotWatch === null || mode !== "grown-up") return;
    const live = snapshot.requests.filter((request) => !request.lapsed);
    if (told.current === null) {
      // What was already waiting when SKYCOT opened is on the screen: no notification for it.
      if (
        !macs.every(
          (mac) => byMac[mac.macId]?.requests !== null && byMac[mac.macId]?.requests !== undefined,
        )
      ) {
        return;
      }
      told.current = new Set(live.map((request) => request.id));
      if (testSetting("skycotTestQuiet") === null) {
        void SkycotWatch.requestNotifications().catch(() => false);
      }
      return;
    }
    for (const request of live) {
      if (told.current.has(request.id)) continue;
      told.current.add(request.id);
      void SkycotWatch.notifyRequest(request.id, request.title).catch(() => undefined);
    }
    for (const id of told.current) {
      if (!live.some((request) => request.id === id)) SkycotWatch.clearRequest(id);
    }
  }, [snapshot.requests, mode, macs, byMac]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && SkycotWatch !== null) setLink(SkycotWatch.state());
    });
    return () => subscription.remove();
  }, []);

  const enrol = useCallback(
    async (code: string): Promise<string | null> => {
      if (SkycotWatch === null || !link.paired)
        return "Pair an Apple Watch with this iPhone first.";
      if (!link.installed) {
        return "Install SKYCOT on your Apple Watch first (the Watch app on this iPhone, Available Apps).";
      }
      for (const mac of macsRef.current) {
        const options = await familyApi.watchOptions(mac.transport, code);
        if (!options.ok) return options.message;
        const request: WatchEnrolRequest = {
          type: "enrol",
          challenge: options.value.challenge,
          action: options.value.action,
        };
        let answer: string;
        try {
          answer = await SkycotWatch.sendToWatch(JSON.stringify(request));
        } catch (cause) {
          return cause instanceof Error && cause.message.length > 0
            ? cause.message
            : "Open SKYCOT on your Apple Watch, then try again.";
        }
        const made = parseEnrolReply(answer);
        if (made === null) {
          return "The Watch couldn't make its key. Check it's unlocked and on your wrist, then try again.";
        }
        const registered = await familyApi.watchRegister(mac.transport, {
          challenge: options.value.challenge,
          ...made,
        });
        if (!registered.ok) return registered.message;
        await refresh(mac.macId);
      }
      return null;
    },
    [link.paired, link.installed, refresh],
  );

  // Development builds: the Simulator check's "Set up" (see testSetting).
  const testedSetup = useRef(false);
  const statusesLoaded = macs.length > 0 && macs.every((mac) => byMac[mac.macId]?.status != null);
  useEffect(() => {
    const code = testSetting("skycotTestWatchSetup");
    if (code === null || testedSetup.current || !statusesLoaded || !link.reachable) return;
    if (mode !== "grown-up") return;
    testedSetup.current = true;
    void enrol(code).then((problem) =>
      console.log("[skycot] test Watch setup:", problem ?? "done"),
    );
  }, [statusesLoaded, link.reachable, mode, enrol]);

  const forget = useCallback(async (): Promise<string | null> => {
    for (const mac of macsRef.current) {
      const result = await familyApi.watchForget(mac.transport);
      if (!result.ok) return result.message;
      await refresh(mac.macId);
    }
    return null;
  }, [refresh]);

  const watchName = useMemo(() => {
    if (!snapshot.watchSetUp) return null;
    for (const mac of macs) {
      const me = (byMac[mac.macId]?.status?.devices ?? []).find(
        (device) => device.id === mac.me.deviceId,
      );
      if (me?.watch) return me.watch;
    }
    return null;
  }, [snapshot.watchSetUp, macs, byMac]);

  const value = useMemo<WatchValue>(
    () => ({
      link,
      watchName,
      lockedAt,
      noteLocked: () => setLockedAt(Date.now()),
      enrol,
      forget,
    }),
    [link, watchName, lockedAt, enrol, forget],
  );
  return <WatchContext value={value}>{props.children}</WatchContext>;
}
