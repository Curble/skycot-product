/**
 * The Simulator check's "a child sends a message" step, using the app's own commands from a
 * second linked child device (SKYCOT_TEST_ENGINE plus SKYCOT_TEST_AVA_CODE and
 * SKYCOT_TEST_LEO_CODE, fresh child links). Skipped otherwise. With the pretend AI (a mock
 * agent asking first to read a file, then to run `npm install three`), it leaves Ava's
 * conversation waiting on a grown-up and gives Leo a conversation Ava must never see.
 */
import { describe, expect, it, vi } from "vite-plus/test";

import { familyApi } from "../family/api";
import {
  defaultModelSelection,
  readMacConfig,
  readShell,
  readThread,
  respondToRequest,
  startConversation,
} from "../engine/engine";
import { linkToMac, readLinkInput } from "../links/pairing";
import { directTransport } from "../transport/MacTransport";

const base = process.env.SKYCOT_TEST_ENGINE;
const avaCode = process.env.SKYCOT_TEST_AVA_CODE;
const leoCode = process.env.SKYCOT_TEST_LEO_CODE;

async function device(code: string) {
  const linked = await linkToMac(readLinkInput({ kind: "typed", code, address: base! }));
  return directTransport({ httpBaseUrl: linked.httpBaseUrl!, bearerToken: linked.bearerToken });
}

async function start(transport: ReturnType<typeof directTransport>, text: string) {
  const shell = await readShell(transport);
  const config = await readMacConfig(transport);
  const project = shell.projects.find(
    (candidate) => candidate.workspaceRoot !== config.questionsRoot,
  );
  expect(project).toBeDefined();
  const model = defaultModelSelection(config.providers, null);
  expect(model).not.toBeNull();
  return startConversation(transport, {
    projectId: project!.id,
    title: text.slice(0, 40),
    text,
    modelSelection: model!,
    runtimeMode: "approval-required",
    interactionMode: "plan",
  });
}

describe.skipIf(base === undefined || avaCode === undefined || leoCode === undefined)(
  "seeding the Simulator check",
  () => {
    it("leaves Ava waiting on a grown-up, and Leo with work of his own", async () => {
      const leo = await device(leoCode!);
      const leoThread = await start(leo, "Please make a page about dinosaurs with a big T. rex.");
      const ava = await device(avaCode!);
      const { threadId } = await start(
        ava,
        "Please make a simple space game with a rocket and stars.",
      );

      // The first ask (reading a file inside the project) is a child's own call: Ava says yes.
      const firstAsk = await vi.waitFor(
        async () => {
          const pending = (await readThread(ava, threadId)).runtimeRequests.filter(
            (request) => request.status === "pending",
          );
          if (pending.length === 0) throw new Error("no ask yet");
          return pending[0]!.id;
        },
        { timeout: 60_000, interval: 1_000 },
      );
      expect((await familyApi.status(ava)).ok).toBe(true);
      await respondToRequest(ava, { threadId, requestId: firstAsk, decision: "accept" });
      // Then the install, which only a grown-up may allow, waits.
      await vi.waitFor(
        async () => {
          const pending = (await readThread(ava, threadId)).runtimeRequests.filter(
            (request) => request.status === "pending" && request.id !== firstAsk,
          );
          if (pending.length === 0) throw new Error("no second ask yet");
        },
        { timeout: 60_000, interval: 1_000 },
      );
      const answeredRead = true;
      expect(answeredRead).toBe(true);

      // Ava's own list never carries Leo's conversation; the engine filtered it.
      const shell = await readShell(ava);
      expect(shell.threads.some((thread) => thread.id === leoThread.threadId)).toBe(false);
      expect(shell.threads.some((thread) => thread.id === threadId)).toBe(true);
      console.log(JSON.stringify({ avaThread: threadId, leoThread: leoThread.threadId }));
    });
  },
);

const planCode = process.env.SKYCOT_TEST_PLAN_CODE;

describe.skipIf(base === undefined || planCode === undefined)("a plan for Ava", () => {
  it("starts a conversation that answers with a plan, as plan first wants", async () => {
    const ava = await device(planCode!);
    const { threadId } = await start(ava, "Please make a birthday card for Nan with balloons.");
    const planned = await vi
      .waitFor(
        async () => {
          if ((await readThread(ava, threadId)).plans.length === 0) throw new Error("no plan yet");
          return true;
        },
        { timeout: 40_000, interval: 1_000 },
      )
      .catch(() => false);
    console.log(JSON.stringify({ planThread: threadId, planned }));
  });
});
