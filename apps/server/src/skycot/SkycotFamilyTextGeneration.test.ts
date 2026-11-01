import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CodexSettings, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import { writeFakeCli } from "@t3tools/provider-testing/fakeCli";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import { makeCodexTextGeneration } from "../textGeneration/CodexTextGeneration.ts";
import * as SkycotFamily from "./SkycotFamily.ts";
import * as SkycotFamilyLockdown from "./SkycotFamilyLockdown.ts";
import * as SkycotFamilyTextGeneration from "./SkycotFamilyTextGeneration.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);

const titleInput = (instanceId: string) => ({
  cwd: process.cwd(),
  message: "Make a star page",
  modelSelection: createModelSelection(ProviderInstanceId.make(instanceId), "gpt-5.4-mini"),
});

/** A text generator that reports whether it ran under the lockdown. */
const recordingService = (seen: Array<string | null>): ProviderTextGeneration => {
  const record = SkycotFamilyLockdown.sessionLockdown.pipe(
    Effect.map((lockdown) => {
      seen.push(lockdown?.driver ?? null);
    }),
  );
  return {
    generateThreadTitle: () => record.pipe(Effect.as({ title: "Star" })),
    generateCommitMessage: () => record.pipe(Effect.as({ subject: "s", body: "" })),
    generatePrContent: () => record.pipe(Effect.as({ title: "t", body: "" })),
    generateBranchName: () => record.pipe(Effect.as({ branch: "b" })),
    generateReviewGuide: () => record.pipe(Effect.as({ guide: "" })),
  } as unknown as ProviderTextGeneration;
};

const locked = (
  on: Ref.Ref<boolean>,
  seen: Array<string | null>,
  allowed: ReadonlyArray<string> = [],
) =>
  SkycotFamilyTextGeneration.lockTextGeneration(Effect.succeed(recordingService(seen))).pipe(
    Effect.provideService(SkycotFamily.SkycotFamily, {
      isEnabled: Ref.get(on),
      assistantAllowed: (driver: string) => Effect.succeed(allowed.includes(driver)),
    } as unknown as SkycotFamily.SkycotFamily["Service"]),
    Effect.provideService(ProviderInstanceRegistry.ProviderInstanceRegistry, {
      getInstance: (instanceId: string) =>
        Effect.succeed({ driverKind: ProviderDriverKind.make(instanceId) }),
    } as unknown as ProviderInstanceRegistry.ProviderInstanceRegistry["Service"]),
  );

describe("SkycotFamilyTextGeneration.lockTextGeneration", () => {
  it.effect(
    "runs Codex and Claude text generation under the lockdown while the profile is on",
    () =>
      Effect.gen(function* () {
        const seen: Array<string | null> = [];
        const service = yield* locked(yield* Ref.make(true), seen);
        yield* service.generateThreadTitle(titleInput("codex") as never);
        yield* service.generateCommitMessage({
          modelSelection: titleInput("claudeAgent").modelSelection,
        } as never);
        assert.deepEqual(seen, ["codex", "claudeAgent"]);
      }),
  );

  it.effect("refuses other providers' text generation while the profile is on", () =>
    Effect.gen(function* () {
      const seen: Array<string | null> = [];
      const service = yield* locked(yield* Ref.make(true), seen);
      const error = yield* Effect.flip(
        service.generateThreadTitle(titleInput("opencode") as never),
      );
      assert.include(error.detail, "SKYCOT can't switch off OpenCode's own add-ons");
      assert.lengthOf(seen, 0);
    }),
  );

  it.effect("runs an allowed provider's text generation as upstream does", () =>
    Effect.gen(function* () {
      const seen: Array<string | null> = [];
      const service = yield* locked(yield* Ref.make(true), seen, ["opencode"]);
      yield* service.generateThreadTitle(titleInput("opencode") as never);
      assert.deepEqual(seen, [null]);
      const error = yield* Effect.flip(service.generateThreadTitle(titleInput("cursor") as never));
      assert.include(error.detail, "Cursor isn't allowed in the Family profile yet");
    }),
  );

  it.effect("runs background calls at normal speed while the profile is on", () =>
    Effect.gen(function* () {
      const received: Array<unknown> = [];
      const inner = {
        generateThreadTitle: (input: { modelSelection: { options?: unknown } }) => {
          received.push(input.modelSelection.options);
          return Effect.succeed({ title: "Star" });
        },
      } as unknown as ProviderTextGeneration;
      const run = (on: boolean) =>
        SkycotFamilyTextGeneration.lockTextGeneration(Effect.succeed(inner)).pipe(
          Effect.provideService(SkycotFamily.SkycotFamily, {
            isEnabled: Effect.succeed(on),
            assistantAllowed: () => Effect.succeed(false),
          } as unknown as SkycotFamily.SkycotFamily["Service"]),
          Effect.provideService(ProviderInstanceRegistry.ProviderInstanceRegistry, {
            getInstance: (instanceId: string) =>
              Effect.succeed({ driverKind: ProviderDriverKind.make(instanceId) }),
          } as unknown as ProviderInstanceRegistry.ProviderInstanceRegistry["Service"]),
        );
      const input = {
        ...titleInput("codex"),
        modelSelection: {
          ...titleInput("codex").modelSelection,
          options: [
            { id: "serviceTier", value: "fast" },
            { id: "contextWindow", value: "1m" },
          ],
        },
      };
      yield* (yield* run(true)).generateThreadTitle(input as never);
      yield* (yield* run(false)).generateThreadTitle(input as never);
      assert.deepEqual(received[0], [{ id: "contextWindow", value: "1m" }]);
      assert.deepEqual(received[1], input.modelSelection.options);
    }),
  );

  it.effect("changes nothing while the profile is off", () =>
    Effect.gen(function* () {
      const seen: Array<string | null> = [];
      const service = yield* locked(yield* Ref.make(false), seen);
      yield* service.generateThreadTitle(titleInput("opencode") as never);
      yield* service.generateThreadTitle(titleInput("codex") as never);
      assert.deepEqual(seen, [null, null]);
    }),
  );
});

describe("CodexTextGeneration under the Family lockdown", () => {
  /** A fake `codex` that writes its arguments next to itself and answers with a title. */
  const runTitle = (withLockdown: boolean) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-codex-text-" });
      const argsFile = path.join(dir, "args.json");
      const binary = writeFakeCli({
        directory: path.join(dir, "bin"),
        name: "codex",
        source: [
          'import * as NodeFS from "node:fs";',
          "const args = process.argv.slice(2);",
          'if (args.includes("mcp")) { process.stdout.write("[]"); process.exit(0); }',
          `NodeFS.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args));`,
          'const out = args[args.indexOf("--output-last-message") + 1];',
          "for await (const _ of process.stdin) {}",
          'NodeFS.writeFileSync(out, JSON.stringify({ title: "Star page" }) + "\\n");',
        ].join("\n"),
      });
      const textGeneration = yield* makeCodexTextGeneration(
        decodeCodexSettings({ binaryPath: binary }),
      );
      const title = textGeneration.generateThreadTitle(titleInput("codex"));
      yield* withLockdown
        ? title.pipe(
            Effect.provideService(
              SkycotFamilyLockdown.FamilyLockdownRef,
              new SkycotFamilyLockdown.FamilyLockdown(ProviderDriverKind.make("codex")),
            ),
          )
        : title;
      return (JSON.parse(yield* fs.readFileString(argsFile)) as Array<string>).join(" ");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        ServerConfig.ServerConfig.layerTest(process.cwd(), {
          prefix: "skycot-codex-text-generation-",
        }).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
    );

  it.effect(
    "runs `codex exec` with notify, hooks and computer use off while the profile is on",
    () =>
      Effect.gen(function* () {
        const args = yield* runTitle(true);
        for (const expected of [
          "-c notify=[]",
          "-c features.hooks=false",
          "-c features.computer_use=false",
          "-c features.browser_use=false",
          "-c skills.bundled.enabled=false",
        ]) {
          assert.include(args, expected);
        }
      }),
  );

  it.effect("runs it exactly as upstream while the profile is off", () =>
    Effect.gen(function* () {
      const args = yield* runTitle(false);
      assert.notInclude(args, "notify=[]");
      assert.include(
        args,
        "--config features.plugins=false --config features.apps=false --ephemeral",
      );
    }),
  );
});
