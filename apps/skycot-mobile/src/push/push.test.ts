import { describe, expect, it } from "vite-plus/test";

import {
  homesToRegister,
  parseRegistered,
  pushedDeclineTarget,
  registrationKey,
  stillRegistered,
  type PushHome,
  type WaitingRequest,
} from "./plan";

const token = { token: "ab".repeat(32), environment: "production" } as const;
const kitchen: PushHome = { macId: "mac-1", homeId: "home-1", deviceRelayId: "relay-1" };
const study: PushHome = { macId: "mac-2", homeId: "home-2", deviceRelayId: "relay-2" };

describe("handing the push token to each Mac", () => {
  it("hands it to every Mac the first time", () => {
    expect(homesToRegister([kitchen, study], token, new Set())).toEqual([kitchen, study]);
  });

  it("does not hand the same token over the same link again", () => {
    const done = new Set([registrationKey(kitchen, token)]);
    expect(homesToRegister([kitchen, study], token, done)).toEqual([study]);
  });

  it("hands a new token over again", () => {
    const done = new Set([registrationKey(kitchen, token)]);
    const next = { token: "cd".repeat(32), environment: "production" } as const;
    expect(homesToRegister([kitchen], next, done)).toEqual([kitchen]);
  });

  it("hands it over again after the device is linked again, or on another push service", () => {
    const done = new Set([registrationKey(kitchen, token)]);
    expect(homesToRegister([{ ...kitchen, deviceRelayId: "relay-9" }], token, done)).toHaveLength(
      1,
    );
    expect(homesToRegister([kitchen], { ...token, environment: "development" }, done)).toHaveLength(
      1,
    );
  });

  it("forgets Macs no longer linked and old tokens", () => {
    const old = { token: "ef".repeat(32), environment: "production" } as const;
    const done = new Set([
      registrationKey(kitchen, token),
      registrationKey(study, token),
      registrationKey(kitchen, old),
    ]);
    expect([...stillRegistered([kitchen], token, done)]).toEqual([registrationKey(kitchen, token)]);
  });

  it("reads what it kept, and treats damage as nothing kept", () => {
    expect([...parseRegistered(JSON.stringify(["a", 3, "b"]))]).toEqual(["a", "b"]);
    expect(parseRegistered("{not json").size).toBe(0);
    expect(parseRegistered(null).size).toBe(0);
    expect(parseRegistered('{"a":1}').size).toBe(0);
  });
});

describe("Decline on a pushed notification", () => {
  const request = (requestId: string, lapsed = false): WaitingRequest => ({
    macId: "mac-1",
    threadId: "thread-1",
    requestId,
    fingerprint: "f".repeat(24),
    lapsed,
  });

  it("declines the one waiting request", () => {
    expect(pushedDeclineTarget([request("req-1"), request("req-0", true)])?.requestId).toBe(
      "req-1",
    );
  });

  it("chooses nothing when several or none are waiting", () => {
    expect(pushedDeclineTarget([request("req-1"), request("req-2")])).toBeNull();
    expect(pushedDeclineTarget([])).toBeNull();
    expect(pushedDeclineTarget([request("req-1", true)])).toBeNull();
  });
});
