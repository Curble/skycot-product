/**
 * SKYCOT on a grown-up's Apple Watch, the iPhone side (ios/SkycotWatchModule.swift):
 * WatchConnectivity with the Watch app, the "needs a grown-up" notification with Allow once
 * and Decline, and Apple's push token for SKYCOT Relay. Absent (null) on anything but iOS; see
 * src/watch/WatchBridge.tsx and src/push/PushRegistration.tsx.
 */
import { requireOptionalNativeModule, type EventSubscription } from "expo";

/** Apple's push token, as hex, and which of Apple's push services it is for. */
export interface PushToken {
  readonly token: string;
  readonly environment: "production" | "development";
}

export interface WatchLinkState {
  readonly supported: boolean;
  readonly paired: boolean;
  readonly installed: boolean;
  readonly reachable: boolean;
}

interface SkycotWatchNative {
  state(): WatchLinkState;
  updateContext(json: string): void;
  reply(id: string, json: string): void;
  sendToWatch(json: string): Promise<string>;
  finishNotificationAnswer(id: string): void;
  requestNotifications(): Promise<boolean>;
  registerForPush(): Promise<PushToken>;
  notifyRequest(requestKey: string, title: string): Promise<void>;
  clearRequest(requestKey: string): void;
  addListener(
    event: "onWatchMessage",
    listener: (event: { readonly id: string; readonly json: string }) => void,
  ): EventSubscription;
  addListener(event: "onWatchState", listener: (event: WatchLinkState) => void): EventSubscription;
  addListener(
    event: "onNotificationAnswer",
    listener: (event: {
      readonly id: string;
      readonly action: "allow" | "decline" | "open";
      /** "<macId>:<requestId>"; "" for a push from the relay, which names no request. */
      readonly requestKey: string;
    }) => void,
  ): EventSubscription;
}

export const SkycotWatch = requireOptionalNativeModule<SkycotWatchNative>("SkycotWatch");
