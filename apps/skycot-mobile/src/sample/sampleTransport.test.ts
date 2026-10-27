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
import { createSampleMac, endSampleSession } from "./sampleMode";
import { SAMPLE_SAM_REPLY, createSampleSession } from "./sampleSession";
import { createSampleTransport, type SampleTransport } from "./sampleTransport";

const NOW = Date.parse("2026-10-27T01:00:00Z");
const fetchSpy = vi.fn();
const socketSpy = vi.fn();

beforeEach(() => {
  endSampleSession();
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
  it("approving and declining are acknowledged and counted", async () => {
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
    // The first answer settled it; the second finds nothing left to answer.
    expect(value(await familyApi.pendingRequests(transport))).toHaveLength(0);
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

describe("the sample remembers what you do, for the life of the sample", () => {
  const answer = (transport: SampleTransport, decision: "accept" | "decline") =>
    familyApi.pendingRequests(transport).then(async (waiting) => {
      const [request] = value(waiting);
      return familyApi.answerRequest(transport, {
        threadId: request!.threadId,
        requestId: request!.requestId,
        fingerprint: request!.fingerprint,
        decision,
        proof: { type: "code", code: "1234" },
      });
    });
  const soundRow = async (transport: SampleTransport) => {
    const mac = { macId: "m", macName: "Sample", me: { kind: "grown-up" }, transport } as never;
    const rows = conversationRows([mac], { m: { shell: await readShell(transport) } as never });
    return rows.find((row) => row.thread.id === THREAD.sound);
  };

  it("approving settles the request, the badge and the conversation", async () => {
    const transport = grownUp();
    expect(value(await familyApi.pendingRequests(transport))).toHaveLength(1);
    expect((await soundRow(transport))?.state).toBe("waiting");
    await answer(transport, "accept");
    expect(value(await familyApi.pendingRequests(transport))).toHaveLength(0);
    expect((await soundRow(transport))?.state).toBe("done");
    const projection = await readThread(transport, THREAD.sound);
    const entries = buildTimeline(projection, { projectRoot: "/sample", assistantName: "Sam" });
    expect(entries).not.toContainEqual(expect.objectContaining({ kind: "ask", state: "waiting" }));
    expect(entries).toContainEqual(expect.objectContaining({ kind: "ask", state: "allowed" }));
  });

  it("declining shows as declined", async () => {
    const transport = grownUp();
    await answer(transport, "decline");
    const projection = await readThread(transport, THREAD.sound);
    const entries = buildTimeline(projection, { projectRoot: "/sample", assistantName: "Sam" });
    expect(entries).toContainEqual(expect.objectContaining({ kind: "ask", state: "declined" }));
  });

  it("an engine yes from the conversation settles it too", async () => {
    const transport = child();
    const projection = await readThread(transport, THREAD.sound);
    const pending = projection.runtimeRequests.find((r) => r.status === "pending")!;
    await respondToRequest(transport, {
      threadId: THREAD.sound,
      requestId: pending.id,
      decision: "accept",
    });
    expect((await soundRow(transport))?.state).toBe("done");
    expect(value(await familyApi.pendingRequests(grownUp()))).toHaveLength(1);
  });

  it("keeps everything when the view is switched, and drops it on leaving", async () => {
    const mac = createSampleMac("grown-up", () => NOW);
    await answer(mac.transport as SampleTransport, "accept");
    await familyApi.pin(mac.transport, THREAD.quiz, true);
    const other = createSampleMac("child", () => NOW);
    expect(value(await familyApi.pendingRequests(other.transport))).toHaveLength(0);
    expect((await soundRow(other.transport as SampleTransport))?.state).toBe("done");
    const back = createSampleMac("grown-up", () => NOW);
    expect(value(await familyApi.pendingRequests(back.transport))).toHaveLength(0);
    expect(value(await familyApi.fridge(back.transport)).every((i) => i.pinnedAt !== null)).toBe(
      true,
    );
    endSampleSession();
    const fresh = createSampleMac("grown-up", () => NOW);
    expect(value(await familyApi.pendingRequests(fresh.transport))).toHaveLength(1);
    expect(
      value(await familyApi.fridge(fresh.transport)).find((i) => i.threadId === THREAD.quiz)
        ?.pinnedAt,
    ).toBeNull();
  });

  it("pinning adds to the fridge and taking it down removes it", async () => {
    const transport = grownUp();
    const quiz = async () =>
      value(await familyApi.fridge(transport)).find((i) => i.threadId === THREAD.quiz)!;
    expect((await quiz()).pinnedAt).toBeNull();
    await familyApi.pin(transport, THREAD.quiz, true);
    expect((await quiz()).pinnedAt).toBe(NOW);
    await familyApi.pin(transport, THREAD.quiz, false);
    expect((await quiz()).pinnedAt).toBeNull();
  });

  it("answering the family note marks it done", async () => {
    const transport = grownUp();
    await familyApi.answerFamilyNote(transport, { id: "sample-note-1", minutes: 15 });
    expect(value(await familyApi.familyNotes(transport))[0]).toMatchObject({
      status: "done",
      answer: { minutes: 15 },
    });
    const other = createSampleTransport("grown-up", () => NOW);
    expect(value(await familyApi.familyNotes(other))[0]!.status).toBe("open");
  });

  it("a message in a conversation shows the child's bubble and Sam's fixed reply", async () => {
    const transport = child();
    await sendMessage(transport, { threadId: THREAD.space, text: "Make it faster please" });
    const entries = buildTimeline(await readThread(transport, THREAD.space), {
      projectRoot: "/sample",
      assistantName: "Sam",
    });
    const texts = JSON.stringify(entries);
    expect(texts).toContain("Make it faster please");
    expect(texts).toContain(SAMPLE_SAM_REPLY);
    expect(entries.at(-1)).toMatchObject({ kind: "crew" });
    expect(entries.at(-2)).toMatchObject({ kind: "me" });
    // Another session's transport has none of it.
    const fresh = createSampleTransport("child", () => NOW, createSampleSession());
    expect(JSON.stringify(await readThread(fresh, THREAD.space))).not.toContain("faster please");
  });

  it("never touches the network while remembering", async () => {
    const transport = grownUp();
    await answer(transport, "accept");
    await familyApi.pin(transport, THREAD.quiz, true);
    await sendMessage(transport, { threadId: THREAD.space, text: "hi" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(socketSpy).not.toHaveBeenCalled();
  });
});
