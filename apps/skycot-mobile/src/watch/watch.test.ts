import { describe, expect, it } from "vite-plus/test";

// nondev-seam: skycot-watch-project-approval-test

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
  notes: [],
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
  // nondev-seam: skycot-watch-request-sentence-test
  it("leaves out the child's own steps: only what needs a grown-up reaches this phone", () => {
    const step = (requestId: string, needsGrownUp: boolean | undefined) => ({
      threadId: "thread-ava",
      requestId,
      childId: "ava",
      threadTitle: "Space game",
      createdAt: NOW - 60_000,
      lapsed: false,
      ...(needsGrownUp === undefined ? {} : { needsGrownUp }),
      what: requestId === "req-install" ? "npm install three" : "ls",
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
    expect(snapshot.requests[0]?.sentence).toBe(
      "Ava's game wants to download a free 3D tool (three.js) from the internet.",
    );
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

  it("shows the page and exact sites on the Watch before a grown-up says yes", () => {
    const pageRequest = parsePendingRequests({
      requests: [
        {
          threadId: "thread-ava",
          requestId: "page-internet:ask-1",
          target: "page-internet",
          childId: "ava",
          createdAt: NOW,
          lapsed: false,
          needsGrownUp: true,
          what: "dogs.html wants internet from dog.ceo",
          why: "This page wants the internet.",
          kind: "page-internet",
          page: "/games/dogs.html",
          sites: ["dog.ceo"],
          fingerprint: "page-fingerprint",
        },
      ],
    });
    const snapshot = buildWatchSnapshot({
      mode: "grown-up",
      macs: [mac],
      byMac: { [mac.macId]: { ...state("Mum's Watch"), requests: pageRequest } },
      lockedAt: null,
      now: NOW,
    });
    expect(snapshot.requests[0]).toMatchObject({
      requestId: "page-internet:ask-1",
      heading: "This page wants the internet",
      sentence: "Ava's dogs.html wants pictures and information from dog.ceo.",
      fingerprint: "page-fingerprint",
    });
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

describe("family notes on the Watch", () => {
  const notes = [
    {
      id: "n-shown",
      kind: "shown" as const,
      childId: "ava",
      createdAt: "2026-10-24T09:20:00.000Z",
      status: "open" as const,
      threadId: "thread-ava",
      title: "Space game",
    },
    {
      id: "n-time",
      kind: "more-time" as const,
      childId: "leo",
      createdAt: "2026-10-24T09:25:00.000Z",
      status: "open" as const,
    },
    {
      id: "n-old",
      kind: "more-time" as const,
      childId: "ava",
      createdAt: "2026-10-24T08:00:00.000Z",
      status: "done" as const,
      answer: { minutes: 15 as const, by: "Mum", at: "2026-10-24T08:05:00.000Z" },
    },
  ];
  const snapshot = (macState: MacState = { ...state("Mum's Apple Watch"), notes }) =>
    buildWatchSnapshot({
      mode: "grown-up",
      macs: [mac],
      byMac: { "mac-1": macState },
      lockedAt: null,
      now: NOW,
    });

  it("lists open notes, newest first, in plain words", () => {
    expect(snapshot().notes.map((note) => [note.id, note.kind, note.title, note.sentence])).toEqual(
      [
        [
          "mac-1:n-time",
          "more-time",
          "Leo asked for more time",
          "Leo would like more time on SKYCOT.",
        ],
        [
          "mac-1:n-shown",
          "shown",
          "Ava made something",
          "Ava made something — see it on your phone",
        ],
      ],
    );
    expect(snapshot().notes[1]).toMatchObject({ childInitial: "A", macName: null });
  });

  it("has no notes before the Mac has been read", () => {
    expect(snapshot({ ...state(null), notes: null }).notes).toEqual([]);
    expect(snapshot({ ...state(null), notes: [] }).notes).toEqual([]);
  });

  it("never sends what they made: no conversation, title or project", () => {
    const json = JSON.stringify(snapshot().notes);
    expect(json).not.toContain("Space game");
    expect(json).not.toContain("thread-ava");
  });

  it("reads 'Not tonight' from the Watch, and nothing that gives time", () => {
    const base = { type: "noteNotTonight", macId: "mac-1", noteId: "n-time" };
    expect(parseWatchMessage(JSON.stringify(base))).toEqual(base);
    expect(parseWatchMessage(JSON.stringify({ ...base, noteId: "" }))).toBeNull();
    expect(
      parseWatchMessage(JSON.stringify({ type: "noteNotTonight", macId: "mac-1" })),
    ).toBeNull();
    // More time stays with the parent code on the phone: the Watch has no message for it, even
    // with a signature, and a "minutes" field on this one is ignored.
    for (const type of ["noteAnswer", "noteMoreTime"]) {
      expect(
        parseWatchMessage(
          JSON.stringify({
            type,
            macId: "mac-1",
            noteId: "n-time",
            minutes: 15,
            proof: { keyId: "k", challenge: "c", signature: "s" },
          }),
        ),
      ).toBeNull();
    }
    expect(parseWatchMessage(JSON.stringify({ ...base, minutes: 30 }))).toEqual(base);
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

  it("accepts a batch challenge and answer without a single-request identifier", () => {
    expect(
      parseWatchMessage(
        JSON.stringify({
          type: "challenge",
          macId: "mac-1",
          batchId: "batch-1",
          fingerprint: "batch-fp",
        }),
      ),
    ).toMatchObject({ type: "challenge", batchId: "batch-1", fingerprint: "batch-fp" });
    expect(
      parseWatchMessage(
        JSON.stringify({
          type: "answer",
          macId: "mac-1",
          batchId: "batch-1",
          fingerprint: "batch-fp",
          decision: "accept",
          proof: { keyId: "k", challenge: "c", signature: "s" },
        }),
      ),
    ).toMatchObject({ type: "answer", batchId: "batch-1", decision: "accept" });
  });

  it("refuses anything that isn't once: no 'always', no strangers", () => {
    expect(parseWatchMessage(JSON.stringify({ ...answer, decision: "acceptAlways" }))).toBeNull();
    expect(parseWatchMessage(JSON.stringify({ type: "unlink" }))).toBeNull();
    expect(parseWatchMessage("not json")).toBeNull();
    expect(parseWatchMessage(JSON.stringify({ type: "lock" }))).toEqual({ type: "lock" });
    expect(
      parseWatchMessage(
        JSON.stringify({
          ...answer,
          decision: "accept",
          scope: "project",
          proof: { keyId: "k", challenge: "c", signature: "s" },
        }),
      ),
    ).toMatchObject({ decision: "accept", scope: "project" });
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
