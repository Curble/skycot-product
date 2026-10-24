import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  approvedAddOnsFor,
  makeAddOnStore,
  readAddOnFile,
  REPEAT_APPROVAL_MS,
  withAdded,
  withApproval,
  type AddOnFile,
} from "./SkycotAddOnApprovals.ts";
import { becauseFor, noteForAssistant } from "./SkycotApprovedInstalls.ts";

const EMPTY: AddOnFile = { version: 1, approvals: {}, added: [] };
const T0 = 1_800_000_000_000;

describe("SkycotAddOnApprovals", () => {
  it("one yes covers that add-on in that conversation, for 7 days, and nothing else", () => {
    const file = withApproval(EMPTY, "thread:a", ["three", "three"], T0);
    assert.deepStrictEqual(approvedAddOnsFor(file, "thread:a", T0 + 1), ["three"]);
    assert.deepStrictEqual(approvedAddOnsFor(file, "thread:b", T0 + 1), []);
    assert.deepStrictEqual(approvedAddOnsFor(file, "thread:a", T0 + REPEAT_APPROVAL_MS), []);
    // A later yes never stretches the first one's 7 days.
    const again = withApproval(file, "thread:a", ["three", "p5"], T0 + 1000);
    assert.deepStrictEqual(again.approvals["thread:a"], [
      { name: "three", at: T0 },
      { name: "p5", at: T0 + 1000 },
    ]);
  });

  it("is capped: old conversations and old notes fall away", () => {
    let file = EMPTY;
    for (let index = 0; index < 250; index++) {
      file = withApproval(file, `thread:${index}`, ["three"], T0 + index);
    }
    assert.equal(Object.keys(file.approvals).length, 200);
    assert.isDefined(file.approvals["thread:249"]);
    assert.isUndefined(file.approvals["thread:0"]);
    let logged = EMPTY;
    for (let index = 0; index < 400; index++) {
      logged = withAdded(logged, { at: T0 + index, threadId: "t", names: ["p5"], how: "trusted" });
    }
    assert.equal(logged.added.length, 300);
  });

  it.effect("writes its file atomically, readable only by this user", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-add-ons-" });
      const filePath = `${dir}/skycot-add-ons.json`;
      const store = yield* makeAddOnStore(filePath);
      yield* store.approve("thread:a", ["dayjs"]);
      yield* store.recordAdded({ threadId: "thread:a", names: ["three"], how: "trusted" });
      const file = yield* readAddOnFile(filePath);
      assert.deepStrictEqual(
        file.approvals["thread:a"]?.map((approval) => approval.name),
        ["dayjs"],
      );
      assert.deepStrictEqual(
        file.added.map((entry) => [entry.names, entry.how]),
        [[["three"], "trusted"]],
      );
      const info = yield* fs.stat(filePath);
      assert.equal(Number(info.mode) & 0o777, 0o600);
      assert.deepStrictEqual(
        (yield* fs.readDirectory(dir)).filter((name) => name.endsWith(".tmp")),
        [],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it("tells the assistant why SKYCOT did it", () => {
    const install = { manager: "npm", packages: ["three"], dev: false } as const;
    assert.include(
      noteForAssistant(install, { ok: true }, becauseFor("trusted-add-on")),
      "this is a trusted add-on, so SKYCOT installed three",
    );
    assert.include(noteForAssistant(install, { ok: true }), "a grown-up said yes");
  });
});
