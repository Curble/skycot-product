// The sample family: reads answer through the app's own parsers, writes are harmless
// acknowledgements, and nothing ever reaches the network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { conversationRows } from "../data/conversations";
import {
  answerQuestion,
  readMacConfig,
  readShell,
  readThread,
  respondToRequest,
  sendMessage,
  startConversation,
  stopConversation,
  undoTo,
  openQuestions,
  defaultModelSelection,
} from "../engine/engine";
import { buildTimeline } from "../engine/timeline";
import { familyApi } from "../family/api";
import { AVA, LEO, SAMPLE_CODE_LENGTH, THREAD, isSampleMacId } from "./fixtures";
import { createSampleMac } from "./sampleMode";
import { createSampleTransport, type SampleTransport } from "./sampleTransport";

const NOW = Date.parse("2026-10-27T01:00:00Z");
const fetchSpy = vi.fn();
const socketSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  socketSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal("WebSocket", socketSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const grownUp = (): SampleTransport => createSampleTransport("grown-up", () => NOW);
const child = (): SampleTransport => createSampleTransport("child", () => NOW);

function value<A>(result: { ok: true; value: A } | { ok: false; message: string }): A {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe("the sample family answers reads, through the real parsers", () => {
  it("says who the grown-up's phone is, and the two children", async () => {
    const status = value(await familyApi.status(grownUp()));
    expect(status.enabled).toBe(true);
    expect(status.me).toMatchObject({ kind: "grown-up" });
    expect(status.children.map((entry) => entry.name)).toEqual(["Ava", "Leo"]);
    expect(status.grownUps?.map((entry) => entry.name)).toEqual(["Sam's grown-up"]);
    expect(status.codeLength).toBe(SAMPLE_CODE_LENGTH);
    expect(value(await familyApi.today(grownUp())).children).toHaveLength(2);
  });

  it("is Ava's own device in the child view", async () => {
    const status = value(await familyApi.status(child()));
    expect(status.me).toMatchObject({ kind: "child", childId: AVA });
    expect(status.session).toMatchObject({ childId: AVA, device: "child" });
    expect(status.session?.limits?.asleep).toBe(false);
    expect(value(await familyApi.stickers(child())).book?.creations).toBe(2);
  });

  it("has one pending request to approve, and a family note", async () => {
    const waiting = value(await familyApi.pendingRequests(grownUp()));
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ childId: AVA, needsGrownUp: true, lapsed: false });
    expect(value(await familyApi.familyNotes(grownUp()))).toHaveLength(1);
  });

  it("has fridge pages that open, and picture cards", async () => {
    const transport = grownUp();
    const fridge = value(await familyApi.fridge(transport));
    expect(fridge).toHaveLength(2);
    for (const item of fridge) {
      expect(value(await familyApi.fridgePage(transport, item.threadId, item.page))).toContain(
        "<html",
      );
      const play = value(await familyApi.fridgePlay(transport, item.threadId, item.page));
      expect(play.html).toContain("<html");
      expect(await familyApi.fridgeCard(transport, item.cardHash!)).toContain("<svg");
    }
  });

  it("has a week's recap for each child", async () => {
    for (const childId of [AVA, LEO]) {
      const recap = value(await familyApi.recap(grownUp(), childId, "week"));
      expect(recap.childId).toBe(childId);
      expect(recap.made.length).toBeGreaterThan(0);
    }
  });

  it("lists the recorded conversations, and opens each as cards", async () => {
    const transport = grownUp();
    const shell = await readShell(transport);
    expect(shell.threads.length).toBeGreaterThanOrEqual(2);
    expect(shell.threads.length).toBeLessThanOrEqual(4);
    for (const thread of shell.threads) {
      const projection = await readThread(transport, thread.id);
      const entries = buildTimeline(projection, {
        projectRoot: "/sample",
        assistantName: "Sam",
      });
      expect(entries.length).toBeGreaterThan(1);
    }
    const sound = await readThread(transport, THREAD.sound);
    expect(buildTimeline(sound, { projectRoot: "/sample", assistantName: "Sam" })).toContainEqual(
      expect.objectContaining({ kind: "ask", state: "waiting" }),
    );
  });

  it("shows the waiting conversation as waiting, and Ava's device only Ava's", async () => {
    const mac = createSampleMac("grown-up", () => NOW);
    const all = conversationRows([mac], {
      [mac.macId]: { shell: await readShell(mac.transport) } as never,
    });
    expect(all.find((row) => row.thread.id === THREAD.sound)?.state).toBe("waiting");
    const kid = createSampleMac("child", () => NOW);
    const own = conversationRows([kid], {
      [kid.macId]: { shell: await readShell(kid.transport) } as never,
    });
    expect(own.length).toBeGreaterThan(0);
    const owners = value(await familyApi.today(child())).threads;
    for (const row of own) expect(owners[row.thread.id]).toBe(AVA);
    await expect(readThread(kid.transport, THREAD.quiz)).rejects.toThrow();
  });

  it("answers an unknown path as not found, never as a network error", async () => {
    const answer = await grownUp().request({ method: "GET", path: "/api/nothing" });
    expect(answer.status).toBe(404);
  });

  it("gives New conversation a pretend assistant so it can be tried", async () => {
    const config = await readMacConfig(child());
    expect(defaultModelSelection(config.providers, null)).not.toBeNull();
  });
});

describe("every write is a harmless acknowledgement", () => {
  it("approving and declining change nothing and are only counted", async () => {
    const transport = grownUp();
    const [request] = value(await familyApi.pendingRequests(transport));
    const input = {
      threadId: request!.threadId,
      requestId: request!.requestId,
      fingerprint: request!.fingerprint,
    };
    expect(
      (
        await familyApi.answerRequest(transport, {
          ...input,
          decision: "accept",
          proof: { type: "code", code: "1234" },
        })
      ).ok,
    ).toBe(true);
    expect(
      (await familyApi.answerRequest(transport, { ...input, decision: "decline", proof: null })).ok,
    ).toBe(true);
    expect(transport.acknowledged()).toEqual([
      "/api/skycot/family/approver/answer",
      "/api/skycot/family/approver/answer",
    ]);
    // Nothing actually changed: the request is still there to try again.
    expect(value(await familyApi.pendingRequests(transport))).toHaveLength(1);
  });

  it("more time, lock everything, notes, pins and the parent code all just say yes", async () => {
    const transport = grownUp();
    expect((await familyApi.verify(transport, { code: "0000", purpose: "settings" })).ok).toBe(
      true,
    );
    expect((await familyApi.lockEverything(transport)).ok).toBe(true);
    expect(
      (await familyApi.answerFamilyNote(transport, { id: "sample-note-1", minutes: 15 })).ok,
    ).toBe(true);
    expect((await familyApi.pin(transport, THREAD.space, false)).ok).toBe(true);
    expect((await familyApi.unlinkSelf(transport)).ok).toBe(true);
    expect(
      (
        await familyApi.approverMoreTime(transport, {
          childId: AVA,
          kind: "extra15",
          code: "1234",
        } as never)
      ).ok,
    ).toBe(true);
    expect(transport.acknowledged()).toHaveLength(6);
  });

  it("the engine's commands never open a channel", async () => {
    const transport = child();
    const spy = vi.spyOn(transport, "socket");
    await sendMessage(transport, { threadId: THREAD.sound, text: "hello" });
    await respondToRequest(transport, {
      threadId: THREAD.sound,
      requestId: "r",
      decision: "accept",
    });
    await answerQuestion(transport, { threadId: THREAD.sound, requestId: "r", answers: {} });
    await undoTo(transport, { threadId: THREAD.space, scopeId: "s", checkpointId: "c" });
    await stopConversation(transport, THREAD.sound);
    expect((await openQuestions(transport)).projectId).toBeTruthy();
    const started = await startConversation(transport, {
      projectId: "p",
      title: "t",
      text: "a",
      modelSelection: { instanceId: "sample", model: "sample" } as never,
      runtimeMode: "approval-required",
      interactionMode: "plan",
    });
    // It opens a recorded plan; nothing was started.
    expect((await readThread(transport, started.threadId)).thread.id).toBe(started.threadId);
    expect(spy).not.toHaveBeenCalled();
  });

  it("Face ID, the Watch and passkeys are not part of the sample", async () => {
    const transport = grownUp();
    const refused = await familyApi.deviceKeyOptions(transport, "1234");
    expect(refused.ok).toBe(false);
    await expect(transport.socket()).rejects.toThrow();
  });
});

describe("nothing reaches the network", () => {
  it("never calls fetch or opens a WebSocket, whatever is read or written", async () => {
    for (const make of [grownUp, child]) {
      const transport = make();
      await familyApi.status(transport);
      await familyApi.today(transport);
      await familyApi.heartbeat(transport, true);
      await familyApi.pendingRequests(transport);
      await familyApi.fridge(transport);
      await familyApi.lockEverything(transport);
      await readShell(transport);
      await readThread(transport, THREAD.space);
      await sendMessage(transport, { threadId: THREAD.space, text: "x" });
      await transport.socket().catch(() => undefined);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(socketSpy).not.toHaveBeenCalled();
  });

  it("is built to stay off the network: the sample has no address and no relay", () => {
    const mac = createSampleMac("grown-up", () => NOW);
    expect(mac.httpBaseUrl).toBeNull();
    expect(mac.relay).toBeNull();
    expect(mac.relayRecord).toBeNull();
    expect(mac.bearerToken).toBe("");
    expect(mac.transport.kind).toBe("sample");
    expect(isSampleMacId(mac.macId)).toBe(true);
  });
});
