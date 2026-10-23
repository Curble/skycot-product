import type { OrchestrationV2Run, OrchestrationV2TurnItem, RunId } from "@t3tools/contracts";
import { withExplainMarker } from "@t3tools/skycot-rules/explain";
import { withPointing } from "@t3tools/skycot-rules/preview";
import { describe, expect, it } from "vite-plus/test";

import { checkpoint, turnItem } from "../../plain/fixtures.test-helpers";
import {
  canOfferEdit,
  countReplaced,
  copy,
  editableText,
  filesChoice,
  foldTakenBack,
  rewindCheck,
  rewindProgress,
  rolledBackRunIds,
  type RewindProjection,
} from "./rewind";

const PROVIDER_THREAD = "provider-thread-1";

function run(
  ordinal: number,
  status: OrchestrationV2Run["status"] = "completed",
  extra: Partial<Record<string, unknown>> = {},
): OrchestrationV2Run {
  return {
    id: `run-${ordinal}`,
    ordinal,
    status,
    providerThreadId: PROVIDER_THREAD,
    checkpointId: `ckpt-${ordinal}`,
    ...extra,
  } as unknown as OrchestrationV2Run;
}

const start = checkpoint({
  id: "ckpt-start",
  runId: null,
  ordinalWithinScope: 0,
  appRunOrdinal: null,
  files: [],
});
const pointAfter = (ordinal: number, files: ReadonlyArray<string>, status = "ready") =>
  checkpoint({
    id: `ckpt-${ordinal}`,
    runId: `run-${ordinal}`,
    ordinalWithinScope: ordinal,
    appRunOrdinal: ordinal,
    status,
    files: files.map((path) => ({ path, kind: "modified", additions: 1, deletions: 0 })),
  });

function projectionOf(
  runs: ReadonlyArray<OrchestrationV2Run>,
  checkpoints = [start, ...runs.map((r) => pointAfter(r.ordinal, [`page-${r.ordinal}.html`]))],
): RewindProjection {
  return {
    runs,
    checkpoints,
    checkpointScopes: [{ id: "scope-root", kind: "root_run" }],
    thread: { activeProviderThreadId: PROVIDER_THREAD, rollbackFailure: null },
  } as unknown as RewindProjection;
}

const message = (runOrdinal: number, inputIntent = "turn_start", text = "Make it blue") =>
  turnItem("user_message", {
    messageId: `msg-${runOrdinal}`,
    runId: `run-${runOrdinal}`,
    inputIntent,
    text,
    attachments: [],
    createdBy: "user",
    creationSource: "web",
  }) as Extract<OrchestrationV2TurnItem, { type: "user_message" }>;

const ready = { canOperate: true, archived: false, active: false, supportsRollback: true };

describe("canOfferEdit", () => {
  it("offers Edit on the person's own requests that are still in the conversation", () => {
    const runs = [run(1), run(2, "interrupted"), run(3, "failed")];
    for (const ordinal of [1, 2, 3]) expect(canOfferEdit(message(ordinal), runs)).toBe(true);
    expect(canOfferEdit(message(1, "queued_turn"), runs)).toBe(true);
  });

  it("not on a note added while it worked, a message still lined up, or one already replaced", () => {
    const runs = [run(1), run(2, "queued"), run(3, "rolled_back")];
    expect(canOfferEdit(message(1, "steer"), runs)).toBe(false);
    expect(canOfferEdit(message(2), runs)).toBe(false);
    expect(canOfferEdit(message(3), runs)).toBe(false);
    expect(
      canOfferEdit(
        turnItem("assistant_message", { messageId: "m", text: "hi", streaming: false }),
        runs,
      ),
    ).toBe(false);
  });
});

describe("rewindCheck", () => {
  it("goes back to the point captured just before the message, and counts what it replaces", () => {
    const projection = projectionOf([run(1), run(2), run(3)]);
    const check = rewindCheck({ ...ready, projection, item: message(2) });
    expect(check).toEqual({
      ok: true,
      target: {
        checkpointId: "ckpt-1",
        scopeId: "scope-root",
        witnessRunId: "run-2",
        replacedMessages: 2,
        filesChanged: 2,
      },
    });
  });

  it("the first message goes back to the start of the conversation", () => {
    const check = rewindCheck({ ...ready, projection: projectionOf([run(1)]), item: message(1) });
    expect(check.ok && check.target.checkpointId).toBe("ckpt-start");
    expect(check.ok && check.target.replacedMessages).toBe(1);
  });

  it("skips runs an earlier go-back already replaced", () => {
    // Run 2 was replaced by run 3; going back before run 3 lands after run 1.
    const projection = projectionOf([run(1), run(2, "rolled_back"), run(3)]);
    const check = rewindCheck({ ...ready, projection, item: message(3) });
    expect(check.ok && check.target.checkpointId).toBe("ckpt-1");
    expect(check.ok && check.target.replacedMessages).toBe(1);
  });

  it("counts each changed file once, and none for runs that changed nothing", () => {
    const projection = projectionOf(
      [run(1), run(2), run(3)],
      [start, pointAfter(1, ["a.html"]), pointAfter(2, ["b.html"]), pointAfter(3, ["b.html"])],
    );
    const fromTwo = rewindCheck({ ...ready, projection, item: message(2) });
    expect(fromTwo.ok && fromTwo.target.filesChanged).toBe(1);
    const nothing = rewindCheck({
      ...ready,
      projection: projectionOf([run(1), run(2)], [start, pointAfter(1, []), pointAfter(2, [])]),
      item: message(2),
    });
    expect(nothing.ok && nothing.target.filesChanged).toBe(0);
  });

  it("can't go back while the crew works, or in a put-away conversation, and says which first", () => {
    const projection = projectionOf([run(1), run(2)]);
    expect(rewindCheck({ ...ready, projection, item: message(1), active: true })).toEqual({
      ok: false,
      block: "working",
    });
    expect(
      rewindCheck({ ...ready, projection, item: message(1), active: true, archived: true }),
    ).toEqual({ ok: false, block: "put-away" });
    expect(rewindCheck({ ...ready, projection, item: message(1), canOperate: false })).toEqual({
      ok: false,
      block: "read-only",
    });
  });

  it("explains a message from before a restore point that no longer exists", () => {
    const projection = projectionOf(
      [run(1), run(2)],
      [pointAfter(1, ["a.html"], "missing"), pointAfter(2, ["b.html"])],
    );
    expect(rewindCheck({ ...ready, projection, item: message(2) })).toEqual({
      ok: false,
      block: "too-old",
    });
    // No start point either: the first message can't go back.
    expect(rewindCheck({ ...ready, projection, item: message(1) })).toEqual({
      ok: false,
      block: "too-old",
    });
  });

  it("refuses an AI that can't go back, and a point another AI service ran", () => {
    const projection = projectionOf([run(1, "completed", { providerThreadId: "other" }), run(2)]);
    expect(rewindCheck({ ...ready, projection, item: message(2) })).toEqual({
      ok: false,
      block: "switched-assistant",
    });
    expect(
      rewindCheck({
        ...ready,
        projection: projectionOf([run(1)]),
        item: message(1),
        supportsRollback: false,
      }),
    ).toEqual({ ok: false, block: "no-rollback" });
  });

  it("a replaced message can't be edited again", () => {
    const projection = projectionOf([run(1), run(2, "rolled_back")]);
    expect(rewindCheck({ ...ready, projection, item: message(2) })).toEqual({
      ok: false,
      block: "gone",
    });
  });
});

describe("filesChoice", () => {
  it("offers both when files changed in a private copy", () => {
    expect(
      filesChoice({ filesChanged: 3, worksInPrivateCopy: true, versionBlocker: null }),
    ).toEqual({ kind: "choose" });
  });

  it("has nothing to put back when no file changed", () => {
    expect(
      filesChoice({ filesChanged: 0, worksInPrivateCopy: false, versionBlocker: "x" }),
    ).toEqual({ kind: "nothing" });
  });

  it("keeps the files where Undo would be refused, with the reason", () => {
    expect(
      filesChoice({ filesChanged: 1, worksInPrivateCopy: false, versionBlocker: null }),
    ).toEqual({ kind: "keep-only", because: copy.sharedFolder });
    expect(
      filesChoice({ filesChanged: 1, worksInPrivateCopy: true, versionBlocker: "kept as Git" }),
    ).toEqual({ kind: "keep-only", because: "kept as Git" });
  });
});

describe("rewindProgress", () => {
  const pending = { commandId: "cmd-1", witnessRunId: "run-2" as RunId };
  const thread = (rollbackFailure: unknown = null) => ({ rollbackFailure }) as never;

  it("waits until the engine marks the edited message's run rolled back", () => {
    expect(rewindProgress({ runs: [run(1), run(2)], thread: thread() }, pending)).toBe("waiting");
    expect(
      rewindProgress({ runs: [run(1), run(2, "rolled_back")], thread: thread() }, pending),
    ).toBe("done");
  });

  it("reports the engine's failure for this request only", () => {
    expect(
      rewindProgress(
        { runs: [run(2)], thread: thread({ requestId: "cmd-1", message: "Git is busy" }) },
        pending,
      ),
    ).toEqual({ failed: "Git is busy" });
    expect(
      rewindProgress(
        { runs: [run(2)], thread: thread({ requestId: "cmd-0", message: "old" }) },
        pending,
      ),
    ).toBe("waiting");
  });
});

describe("foldTakenBack", () => {
  const entry = (key: string, runId: string | null) => ({
    kind: "item",
    key,
    runId: runId as RunId | null,
  });

  it("folds what a go-back replaced once the conversation carried on", () => {
    const rolledBack = rolledBackRunIds([
      run(1),
      run(2, "rolled_back"),
      run(3, "rolled_back"),
      run(4),
    ]);
    const folded = foldTakenBack(
      [
        entry("a", "run-1"),
        entry("b", "run-2"),
        entry("c", "run-2"),
        entry("d", "run-3"),
        entry("e", "run-4"),
      ],
      rolledBack,
    );
    expect(folded.map((e) => e.kind)).toEqual(["item", "taken-back", "item"]);
    const fold = folded[1] as { entries: ReadonlyArray<{ key: string }> };
    expect(fold.entries.map((e) => e.key)).toEqual(["b", "c", "d"]);
  });

  it("leaves a just-undone turn open, where its Undone card explains it", () => {
    const rolledBack = rolledBackRunIds([run(1), run(2, "rolled_back")]);
    const folded = foldTakenBack([entry("a", "run-1"), entry("b", "run-2")], rolledBack);
    expect(folded.map((e) => e.kind)).toEqual(["item", "item"]);
  });

  it("does not fold across an entry that belongs to no run", () => {
    const rolledBack = rolledBackRunIds([run(2, "rolled_back")]);
    const folded = foldTakenBack([entry("b", "run-2"), entry("x", null)], rolledBack);
    expect(folded.map((e) => e.kind)).toEqual(["item", "item"]);
  });
});

describe("words", () => {
  it("puts back what the person typed, without SKYCOT's markers", () => {
    const sent = withExplainMarker(
      withPointing("Make this bigger", [
        {
          label: "the red button",
          pageUrl: "http://localhost:5173/",
          tagName: "button",
          selector: "#go",
          html: "<button id=go>Go</button>",
        },
      ]),
      true,
      true,
    );
    expect(editableText(sent)).toEqual({ text: "Make this bigger", pointedAt: 1 });
    expect(editableText("Plain words")).toEqual({ text: "Plain words", pointedAt: 0 });
  });

  it("says how much is replaced", () => {
    expect(countReplaced({ replacedMessages: 1 }, "Sam")).toBe(
      "Sam's reply to it will be replaced.",
    );
    expect(countReplaced({ replacedMessages: 2 }, "Sam")).toBe(
      "This message and the next one, with Sam's replies, will be replaced.",
    );
    expect(countReplaced({ replacedMessages: 4 }, "Sam")).toBe(
      "This message and the 3 after it, with Sam's replies, will be replaced.",
    );
  });

  it("explains every reason it can't go back, naming the crew", () => {
    for (const block of [
      "read-only",
      "gone",
      "put-away",
      "working",
      "no-rollback",
      "switched-assistant",
      "too-old",
    ] as const) {
      const words = copy.blocked(block, "Sam");
      expect(words.title.length).toBeGreaterThan(0);
      expect(words.body).not.toMatch(/checkpoint|rollback|provider|thread/i);
    }
    expect(copy.blocked("working", "Sam").title).toBe("Sam is still working");
  });
});
