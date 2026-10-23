/**
 * Just ask on two children's own devices, with the app's own commands, against a real local
 * engine (SKYCOT_TEST_ENGINE, plus SKYCOT_TEST_JUSTASK_AVA_CODE and SKYCOT_TEST_JUSTASK_LEO_CODE:
 * fresh child links). Skipped otherwise. The Phase 2 bug: whichever child asked first became
 * the owner of the one shared Questions space, and the other child's device was refused.
 * Prints the ids it made, for the screenshots that follow.
 */
import { describe, expect, it } from "vite-plus/test";

import { questionsSpaceOf } from "@t3tools/skycot-rules/questions";

import {
  defaultModelSelection,
  openQuestions,
  readMacConfig,
  readShell,
  startConversation,
} from "../engine/engine";
import { linkToMac, readLinkInput } from "../links/pairing";
import { directTransport } from "../transport/MacTransport";

const base = process.env.SKYCOT_TEST_ENGINE;
const avaCode = process.env.SKYCOT_TEST_JUSTASK_AVA_CODE;
const leoCode = process.env.SKYCOT_TEST_JUSTASK_LEO_CODE;

async function device(code: string) {
  const linked = await linkToMac(readLinkInput({ kind: "typed", code, address: base! }));
  return directTransport({ httpBaseUrl: linked.httpBaseUrl!, bearerToken: linked.bearerToken });
}

async function justAsk(transport: ReturnType<typeof directTransport>, text: string) {
  const config = await readMacConfig(transport);
  const { projectId } = await openQuestions(transport);
  const model = defaultModelSelection(config.providers, null);
  expect(model).not.toBeNull();
  const { threadId } = await startConversation(transport, {
    projectId,
    title: text.slice(0, 40),
    text,
    modelSelection: model!,
    runtimeMode: "approval-required",
    interactionMode: "plan",
  });
  return { projectId, threadId, questionsRoot: config.questionsRoot };
}

describe.skipIf(base === undefined || avaCode === undefined || leoCode === undefined)(
  "Just ask on two children's own devices",
  () => {
    it("both can ask, each in their own space, and neither sees the other's", async () => {
      const ava = await device(avaCode!);
      const leo = await device(leoCode!);
      const avas = await justAsk(ava, "Why is the sky blue?");
      // Before the fix, this one was refused: "That belongs to someone else in the family."
      const leos = await justAsk(leo, "How big was a T. rex?");
      expect(avas.projectId).not.toBe(leos.projectId);

      const avaShell = await readShell(ava);
      const leoShell = await readShell(leo);
      const avaSpace = avaShell.projects.find((project) => project.id === avas.projectId);
      const leoSpace = leoShell.projects.find((project) => project.id === leos.projectId);
      expect(questionsSpaceOf(avaSpace?.workspaceRoot, avas.questionsRoot)?.kind).toBe("child");
      expect(questionsSpaceOf(leoSpace?.workspaceRoot, leos.questionsRoot)?.kind).toBe("child");
      // Each device lists its own question and space only.
      expect(avaShell.threads.map((thread) => thread.id)).toContain(avas.threadId);
      expect(avaShell.threads.map((thread) => thread.id)).not.toContain(leos.threadId);
      expect(avaShell.projects.map((project) => project.id)).not.toContain(leos.projectId);
      expect(leoShell.threads.map((thread) => thread.id)).toContain(leos.threadId);
      expect(leoShell.threads.map((thread) => thread.id)).not.toContain(avas.threadId);
      expect(leoShell.projects.map((project) => project.id)).not.toContain(avas.projectId);

      // Asking in the other's space is refused by the Mac, like a sibling's project.
      const model = defaultModelSelection((await readMacConfig(ava)).providers, null)!;
      await expect(
        startConversation(ava, {
          projectId: leos.projectId,
          title: "Sneaky",
          text: "Hello",
          modelSelection: model,
          runtimeMode: "approval-required",
          interactionMode: "plan",
        }),
      ).rejects.toBeDefined();
      console.log(
        JSON.stringify({
          ava: { thread: avas.threadId, space: avas.projectId },
          leo: { thread: leos.threadId, space: leos.projectId },
        }),
      );
    });
  },
);
