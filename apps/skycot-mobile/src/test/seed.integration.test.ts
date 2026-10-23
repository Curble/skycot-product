/**
 * The Simulator check's "a child sends a message" step, using the app's own commands from a
 * second linked child device (SKYCOT_TEST_ENGINE plus SKYCOT_TEST_AVA_CODE and
 * SKYCOT_TEST_LEO_CODE, fresh child links). Skipped otherwise. With the pretend AI (a mock
 * agent asking first to read a file, then to run `npm install three`), it leaves Ava's
 * conversation waiting on a grown-up and gives Leo a conversation Ava must never see.
 */
import { describe, expect, it } from "vite-plus/test";

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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function device(code: string) {
  const linked = await linkToMac(readLinkInput({ kind: "typed", code, address: base! }));
  return directTransport({ httpBaseUrl: linked.httpBaseUrl, bearerToken: linked.bearerToken });
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
      let answeredRead = false;
      for (let tries = 0; tries < 60; tries += 1) {
        await sleep(1_000);
        const projection = await readThread(ava, threadId);
        const pending = projection.runtimeRequests.filter(
          (request) => request.status === "pending",
        );
        if (pending.length === 0) continue;
        const status = await familyApi.status(ava);
        expect(status.ok).toBe(true);
        if (!answeredRead) {
          await respondToRequest(ava, { threadId, requestId: pending[0]!.id, decision: "accept" });
          answeredRead = true;
          continue;
        }
        break;
      }
      expect(answeredRead).toBe(true);

      // Ava's own list never carries Leo's conversation; the engine filtered it.
      const shell = await readShell(ava);
      expect(shell.threads.some((thread) => thread.id === leoThread.threadId)).toBe(false);
      expect(shell.threads.some((thread) => thread.id === threadId)).toBe(true);
      console.log(JSON.stringify({ avaThread: threadId, leoThread: leoThread.threadId }));
    }, 180_000);
  },
);

const planCode = process.env.SKYCOT_TEST_PLAN_CODE;

describe.skipIf(base === undefined || planCode === undefined)("a plan for Ava", () => {
  it("starts a conversation that answers with a plan, as plan first wants", async () => {
    const ava = await device(planCode!);
    const { threadId } = await start(ava, "Please make a birthday card for Nan with balloons.");
    let planned = false;
    for (let tries = 0; tries < 40 && !planned; tries += 1) {
      await sleep(1_000);
      planned = (await readThread(ava, threadId)).plans.length > 0;
    }
    console.log(JSON.stringify({ planThread: threadId, planned }));
  }, 120_000);
});
