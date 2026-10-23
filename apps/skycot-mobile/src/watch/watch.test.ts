import { describe, expect, it } from "vite-plus/test";

import { parseServerStatus } from "../../../nondev/src/features/family/family";
import { parsePendingRequests } from "../../../nondev/src/features/family/people";
import type { MacState } from "../data/MacData";
import type { MacLink } from "../links/pairing";
import { parseEnrolReply, parseWatchMessage } from "./protocol";
import { buildWatchSnapshot } from "./snapshot";

const NOW = Date.parse("2026-10-24T09:30:00Z");

const mac: MacLink = {
  macId: "mac-1",
  macName: "MamaBear",
  httpBaseUrl: "http://127.0.0.1:3895",
  me: { kind: "grown-up", deviceId: "d2222222222", deviceName: "Mum's iPhone", personId: "mum" },
  linkedAt: NOW,
};

const status = (watch: string | null) =>
  parseServerStatus({
    enabled: true,
    childName: "Ava",
    timeZone: "Australia/Melbourne",
    children: [
      {
        id: "ava",
        name: "Ava",
        avatar: { kind: "initial", color: "berry" },
        limits: { bedtime: { start: "19:30", end: "07:00" }, dailyMinutes: 60, dailyTurns: 30 },
      },
      { id: "leo", name: "Leo", avatar: { kind: "mascot", pose: "yay" } },
    ],
    grownUps: [{ id: "mum", name: "Mum", avatar: { kind: "mascot", pose: "hello" } }],
    devices: [
      { id: "d2222222222", kind: "grown-up", personId: "mum", name: "Mum's iPhone", watch },
    ],
  });

const requests = parsePendingRequests({
  requests: [
    {
      threadId: "thread-ava",
      requestId: "req-1",
      childId: "ava",
      threadTitle: "Space game",
      projectTitle: "Space game",
      createdAt: NOW - 60_000,
      lapsed: false,
      needsGrownUp: true,
      why: "It uses the internet.",
      what: "npm install three",
      kind: "command",
      fingerprint: "3f2a1b0c9d8e7f6a5b4c3d2e",
    },
  ],
});

const state = (watch: string | null): MacState => ({
  status: status(watch),
  shell: null,
  requests,
  today: {
    children: [
      {
        childId: "ava",
        limits: {
          asleep: false,
          reason: null,
          minutesLeft: 37,
          headsUp: false,
          wakesAt: null,
          changesAt: null,
          usedMinutes: 23,
          turns: 7,
          passUntil: null,
          bedtime: null,
          allowance: null,
        },
      },
    ],
    threads: {},
  },
  problem: null,
  signedOut: false,
  reachable: true,
});

describe("what the Watch is sent", () => {
  it("leaves out the child's own steps: only what needs a grown-up reaches this phone", () => {
    const step = (requestId: string, needsGrownUp: boolean | undefined) => ({
      threadId: "thread-ava",
      requestId,
      childId: "ava",
      threadTitle: "Space game",
      createdAt: NOW - 60_000,
      lapsed: false,
      ...(needsGrownUp === undefined ? {} : { needsGrownUp }),
      what: "ls",
      kind: "command",
      fingerprint: `fp-${requestId}`,
    });
    // An older Mac also sent "list the files", "run a short node program" (needsGrownUp: false).
    const mixed = parsePendingRequests({
      requests: [step("req-ls", false), step("req-install", true), step("req-older", undefined)],
    });
    expect(mixed?.map((request) => request.requestId)).toEqual(["req-install", "req-older"]);
    const snapshot = buildWatchSnapshot({
      mode: "grown-up",
      macs: [mac],
      byMac: { [mac.macId]: { ...state("Mum's Watch"), requests: mixed } },
      lockedAt: null,
      now: NOW,
    });
    expect(snapshot.requests.map((request) => request.requestId)).toEqual([
      "req-install",
      "req-older",
    ]);
  });

  it("lists who needs a grown-up, with the phone's words, and each child's day", () => {
    const snapshot = buildWatchSnapshot({
      mode: "grown-up",
      macs: [mac],
      byMac: { "mac-1": state("Mum's Apple Watch") },
      lockedAt: null,
      now: NOW,
    });
    expect(snapshot.state).toBe("ready");
    expect(snapshot.grownUpName).toBe("Mum");
    expect(snapshot.watchSetUp).toBe(true);
    expect(snapshot.requests).toHaveLength(1);
    expect(snapshot.requests[0]).toMatchObject({
      id: "mac-1:req-1",
      title: "Ava needs a grown-up",
      heading: "Run a command",
      what: "npm install three",
      macName: null,
      watchCanSayYes: true,
      childInitial: "A",
    });
    expect(snapshot.children.map((child) => [child.name, child.time, child.bedtime])).toEqual([
      ["Ava", "23 minutes of 1 hour", "Bedtime 7:30 pm to 7 am"],
      ["Leo", "0 minutes", null],
    ]);
    expect(snapshot.children[0]!.messages).toBe("7 of 30 messages");
  });

  it("sends nothing private: no conversation titles, projects, sign-ins or addresses", () => {
    const json = JSON.stringify(
      buildWatchSnapshot({
        mode: "grown-up",
        macs: [mac],
        byMac: { "mac-1": state(null) },
        lockedAt: null,
        now: NOW,
      }),
    );
    expect(json).not.toContain("Space game");
    expect(json).not.toContain("127.0.0.1");
    expect(json).not.toContain("d2222222222");
  });

  it("says when the Watch can't say yes yet, and is for grown-ups' phones only", () => {
    const notSetUp = buildWatchSnapshot({
      mode: "grown-up",
      macs: [mac],
      byMac: { "mac-1": state(null) },
      lockedAt: null,
      now: NOW,
    });
    expect(notSetUp.watchSetUp).toBe(false);
    expect(notSetUp.requests[0]!.watchCanSayYes).toBe(false);
    const child = buildWatchSnapshot({
      mode: "child",
      macs: [],
      byMac: {},
      lockedAt: null,
      now: NOW,
    });
    expect(child.state).toBe("child-device");
    expect(child.requests).toEqual([]);
  });
});

describe("what the Watch may ask", () => {
  const answer = {
    type: "answer",
    macId: "mac-1",
    threadId: "thread-ava",
    requestId: "req-1",
    fingerprint: "f",
  };

  it("reads a yes only with the Watch's signature, and a no without one", () => {
    expect(parseWatchMessage(JSON.stringify({ ...answer, decision: "accept" }))).toBeNull();
    expect(
      parseWatchMessage(
        JSON.stringify({
          ...answer,
          decision: "accept",
          proof: { keyId: "k", challenge: "c", signature: "s" },
        }),
      ),
    ).toMatchObject({ decision: "accept", proof: { keyId: "k" } });
    expect(
      parseWatchMessage(JSON.stringify({ ...answer, decision: "decline", proof: { keyId: "k" } })),
    ).toMatchObject({ decision: "decline", proof: null });
  });

  it("refuses anything that isn't once: no 'always', no strangers", () => {
    expect(parseWatchMessage(JSON.stringify({ ...answer, decision: "acceptAlways" }))).toBeNull();
    expect(parseWatchMessage(JSON.stringify({ type: "unlink" }))).toBeNull();
    expect(parseWatchMessage("not json")).toBeNull();
    expect(parseWatchMessage(JSON.stringify({ type: "lock" }))).toEqual({ type: "lock" });
  });

  it("reads the Watch's new key only when it names where the key lives", () => {
    expect(
      parseEnrolReply(
        JSON.stringify({ publicKey: "p", signature: "s", protection: "secure-enclave" }),
      ),
    ).toEqual({
      publicKey: "p",
      signature: "s",
      protection: "secure-enclave",
      name: "Apple Watch",
    });
    expect(
      parseEnrolReply(JSON.stringify({ publicKey: "p", signature: "s", protection: "cloud" })),
    ).toBeNull();
  });
});
