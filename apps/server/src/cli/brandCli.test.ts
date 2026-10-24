import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as NetService from "@t3tools/shared/Net";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/cli";
import * as TestConsole from "effect/testing/TestConsole";
import { afterEach, vi } from "vite-plus/test";

import type { makeCli } from "../binCli.ts";

// nondev-seam: brand-cli-test. In a SKYCOT build (nondev/brand/env.cjs) the command-line tool is
// `skycot` and names SKYCOT; upstream's tests run with the variables unset and still see `t3`.
const loadBranded = Effect.promise(async () => {
  vi.stubEnv("T3CODE_APP_BASE_NAME", "SKYCOT");
  vi.stubEnv("T3CODE_CLI_NAME", "skycot");
  vi.resetModules();
  return {
    binCli: await import("../binCli.ts"),
    invocation: await import("./invocation.ts"),
    pair: await import("./pair.ts"),
  };
});

const loadUpstream = Effect.promise(async () => {
  vi.resetModules();
  return import("../binCli.ts");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const helpOf = (cli: ReturnType<typeof makeCli>) =>
  Effect.gen(function* () {
    yield* Command.runWith(cli, { version: "0.0.0" })(["--help"]).pipe(Effect.ignore);
    return (yield* TestConsole.logLines).map(String).join("\n");
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        NetService.layer,
        TestConsole.layer,
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
      ),
    ),
  );

it.layer(NodeServices.layer)("the command-line tool in a SKYCOT build", (it) => {
  describe("names", () => {
    it.effect("is called skycot and names SKYCOT in its help", () =>
      Effect.gen(function* () {
        const { binCli } = yield* loadBranded;
        const cli = binCli.makeCli({ cloudEnabled: false });
        expect(cli.name).toBe("skycot");
        const help = yield* helpOf(cli);
        expect(help).toContain("skycot");
        expect(help).toContain("Run the SKYCOT server.");
        expect(help).not.toContain("T3 Code");
        expect(help).not.toMatch(/(^|\s)t3(\s|$)/m);
      }),
    );

    it.effect("suggests skycot commands, never t3", () =>
      Effect.gen(function* () {
        const { invocation, pair } = yield* loadBranded;
        expect(yield* invocation.resolveCliCommand("pair")).toBe("skycot pair");
        const message = new pair.NoRunningServerError({ checkedStatePaths: [] }).message;
        expect(message).toContain("No running SKYCOT server found.");
        expect(message).toContain("`skycot serve`");
        expect(message).not.toContain("t3");
      }),
    );

    it.effect("upstream is unchanged: t3 and T3 Code", () =>
      Effect.gen(function* () {
        const binCli = yield* loadUpstream;
        const cli = binCli.makeCli({ cloudEnabled: false });
        expect(cli.name).toBe("t3");
        expect(yield* helpOf(cli)).toContain("Run the T3 Code server.");
      }),
    );
  });
});
