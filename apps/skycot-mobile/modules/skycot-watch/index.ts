/**
 * SKYCOT on a grown-up's Apple Watch, the iPhone side (ios/SkycotWatchModule.swift):
 * WatchConnectivity with the Watch app, and the "needs a grown-up" notification with Allow once
 * and Decline. Absent (null) on anything but iOS; see src/watch/WatchBridge.tsx.
 */
import { requireOptionalNativeModule, type EventSubscription } from "expo";

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
      readonly requestKey: string;
    }) => void,
  ): EventSubscription;
}

export const SkycotWatch = requireOptionalNativeModule<SkycotWatchNative>("SkycotWatch");
