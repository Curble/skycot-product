import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  type OrchestrationV2AppThread,
  type TerminalEvent,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as PortScanner from "../../preview/PortScanner.ts";
import * as TerminalManager from "../../terminal/Manager.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
import { IDLE_STOP_MS } from "./plan.ts";
import * as SkycotPreview from "./SkycotPreview.ts";

const CODE = "482913";
const SESSION = "session-1";
const NOW = DateTime.makeUnsafe("2026-10-23T09:00:00.000Z");
const THREAD = ThreadId.make("thread:site");
const SIBLING = ThreadId.make("thread:site-2");
const PROJECT = ProjectId.make("project:site");

const threadRow = (id: ThreadId, runtimeMode: OrchestrationV2AppThread["runtimeMode"]) =>
  ({
    createdBy: "user",
    creationSource: "web",
    id,
    projectId: PROJECT,
    title: "My site",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt" },
    runtimeMode,
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
    forkedFrom: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  }) satisfies OrchestrationV2AppThread;

interface World {
  readonly preview: SkycotPreview.SkycotPreview["Service"];
  readonly family: SkycotFamily.SkycotFamily["Service"];
  readonly folder: string;
  /** Every terminal call, in order: "open <cwd> PORT=<n>", "write <data>", "close <thread>". */
  readonly calls: Array<string>;
  /** Sends a terminal event as the engine's terminal manager would. */
  readonly emit: (event: TerminalEvent) => Effect.Effect<void>;
  /** Addresses answering, with their headers. */
  readonly serving: Map<string, Record<string, string>>;
}

const withPreview = <A, E>(
  options: {
    readonly packageJson?: string;
    readonly runtimeMode?: OrchestrationV2AppThread["runtimeMode"];
  },
  use: (world: World) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-preview-" });
    const folder = path.join(dir, "site");
    yield* fs.makeDirectory(folder);
    if (options.packageJson !== undefined) {
      yield* fs.writeFileString(path.join(folder, "package.json"), options.packageJson);
    }
    const calls: Array<string> = [];
    const listeners: Array<(event: TerminalEvent) => Effect.Effect<void>> = [];
    const serving = new Map<string, Record<string, string>>();
    const runtimeMode = options.runtimeMode ?? "approval-required";

    const layerFakes = Layer.mergeAll(
      Layer.mock(TerminalManager.TerminalManager)({
        open: (input) =>
          Effect.sync(() => {
            calls.push(`open ${input.cwd} PORT=${input.env?.["PORT"] ? "set" : "unset"}`);
            return {} as never;
          }),
        write: (input) => Effect.sync(() => void calls.push(`write ${input.data}`)),
        close: (input) => Effect.sync(() => void calls.push(`close ${input.threadId}`)),
        subscribe: (listener) =>
          Effect.sync(() => {
            listeners.push(listener);
            return () => {};
          }),
      }),
      Layer.mock(PortScanner.PortDiscovery)({ scan: () => Effect.succeed([]) }),
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThread: (threadId) => Effect.succeed(threadRow(threadId, runtimeMode)),
      }),
      Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () => Effect.succeed(Option.some({ id: PROJECT, workspaceRoot: folder } as never)),
      }),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          const headers = serving.get(request.url);
          return headers === undefined
            ? Effect.die(new Error("connection refused"))
            : Effect.succeed(
                HttpClientResponse.fromWeb(request, new Response("<h1>hi</h1>", { headers })),
              );
        }),
      ),
      SkycotFamily.layerAt(path.join(dir, SkycotFamily.FAMILY_FILE_NAME)),
    );

    return yield* Effect.gen(function* () {
      const preview = yield* SkycotPreview.SkycotPreview;
      const family = yield* SkycotFamily.SkycotFamily;
      return yield* use({
        preview,
        family,
        folder,
        calls,
        serving,
        emit: (event) =>
          Effect.forEach(listeners, (listener) => listener(event), { discard: true }),
      });
    }).pipe(
      Effect.provide(
        Layer.effect(SkycotPreview.SkycotPreview, SkycotPreview.make).pipe(
          Layer.provideMerge(layerFakes),
        ),
      ),
    );
  }).pipe(Effect.scoped);

const SITE = JSON.stringify({ scripts: { dev: "node server.js" } });
const output = (data: string): TerminalEvent => ({
  type: "output",
  threadId: THREAD,
  terminalId: SkycotPreview.PREVIEW_TERMINAL_ID,
  data,
});

it.layer(NodeServices.layer)("SkycotPreview", (it) => {
  describe("starting", () => {
    it.effect("says when a project has nothing to start", () =>
      withPreview({}, ({ preview }) =>
        Effect.gen(function* () {
          assert.deepEqual(yield* preview.status(THREAD), { state: "no-site" });
          const refused = yield* Effect.flip(
            preview.start({ threadId: THREAD, sessionId: SESSION, approved: true }),
          );
          assert.equal(refused.reason, "not-startable");
        }),
      ),
    );

    it.effect(
      "needs the person's yes in Ask me first, then runs the start script in a terminal",
      () =>
        withPreview({ packageJson: SITE }, ({ preview, folder, calls, emit, serving }) =>
          Effect.gen(function* () {
            const ready = yield* preview.status(THREAD);
            assert.equal(ready.state, "ready");
            assert.deepEqual(ready.state === "ready" ? ready.decision : null, {
              kind: "ask",
              reasons: [],
            });
            const refused = yield* Effect.flip(
              preview.start({ threadId: THREAD, sessionId: SESSION, approved: false }),
            );
            assert.equal(refused.reason, "needs-approval");
            assert.deepEqual(calls, []);

            const starting = yield* preview.start({
              threadId: THREAD,
              sessionId: SESSION,
              approved: true,
            });
            assert.equal(starting.state, "starting");
            assert.deepEqual(calls, [`open ${folder} PORT=set`, "write npm run dev; exit\r"]);

            // The server prints its address; once it answers there, the preview shows it.
            yield* emit(output("  ➜  Local:   http://localhost:5173/\r\n"));
            assert.equal((yield* preview.status(THREAD)).state, "starting");
            serving.set("http://localhost:5173/", { "x-frame-options": "DENY" });
            assert.deepEqual(yield* preview.status(THREAD), {
              state: "running",
              command: {
                runner: "npm run dev",
                script: "node server.js",
                source: "package.json",
                previewUrl: null,
              },
              url: "http://localhost:5173/",
              frameable: false,
            });
            // Starting again leaves the running site alone.
            yield* preview.start({ threadId: THREAD, sessionId: SESSION, approved: true });
            assert.equal(calls.filter((call) => call.startsWith("open")).length, 1);
          }),
        ),
    );

    it.effect("starts by itself in Just do it, carefully", () =>
      withPreview({ packageJson: SITE, runtimeMode: "auto-accept-edits" }, ({ preview, calls }) =>
        Effect.gen(function* () {
          const ready = yield* preview.status(THREAD);
          assert.equal(ready.state === "ready" ? ready.decision.kind : null, "start");
          yield* preview.start({ threadId: THREAD, sessionId: SESSION, approved: false });
          assert.equal(calls.length, 2);
        }),
      ),
    );

    it.effect("reports a start that ended, with what it printed, and starts afresh on retry", () =>
      withPreview({ packageJson: SITE }, ({ preview, calls, emit }) =>
        Effect.gen(function* () {
          yield* preview.start({ threadId: THREAD, sessionId: SESSION, approved: true });
          yield* emit(output("Error: Cannot find module 'server.js'\r\n"));
          yield* emit({
            type: "exited",
            threadId: THREAD,
            terminalId: SkycotPreview.PREVIEW_TERMINAL_ID,
            exitCode: 1,
            exitSignal: null,
          });
          const failed = yield* preview.status(THREAD);
          assert.equal(failed.state, "failed");
          assert.equal(failed.state === "failed" ? failed.reason : null, "exited");
          assert.include(failed.state === "failed" ? failed.output : "", "Cannot find module");

          const again = yield* preview.start({
            threadId: THREAD,
            sessionId: SESSION,
            approved: true,
          });
          assert.equal(again.state, "starting");
          assert.deepEqual(
            calls.map((call) => call.split(" ")[0]),
            ["open", "write", "close", "open", "write"],
          );
        }),
      ),
    );

    it.effect("gives up waiting for an address after the start timeout", () =>
      withPreview({ packageJson: SITE }, ({ preview }) =>
        Effect.gen(function* () {
          yield* preview.start({ threadId: THREAD, sessionId: SESSION, approved: true });
          yield* TestClock.adjust("2 minutes");
          const failed = yield* preview.status(THREAD);
          assert.equal(failed.state === "failed" ? failed.reason : failed.state, "no-address");
        }),
      ),
    );

    it.effect("shares one site between conversations working in the same folder", () =>
      withPreview({ packageJson: SITE }, ({ preview, calls, emit, serving }) =>
        Effect.gen(function* () {
          yield* preview.start({ threadId: THREAD, sessionId: SESSION, approved: true });
          yield* emit(output("listening on http://127.0.0.1:4321\n"));
          serving.set("http://127.0.0.1:4321/", {});
          const seen = yield* preview.status(SIBLING);
          assert.equal(seen.state === "running" ? seen.url : seen.state, "http://127.0.0.1:4321/");
          yield* preview.stop(SIBLING);
          assert.deepEqual(calls.at(-1), `close ${THREAD}`);
          assert.equal((yield* preview.status(THREAD)).state, "ready");
        }),
      ),
    );

    it.effect("stops a site nobody has looked at for a while", () =>
      withPreview({ packageJson: SITE }, ({ preview, calls }) =>
        Effect.gen(function* () {
          yield* preview.start({ threadId: THREAD, sessionId: SESSION, approved: true });
          yield* TestClock.adjust(IDLE_STOP_MS + 2 * 60_000);
          assert.deepEqual(calls.at(-1), `close ${THREAD}`);
        }),
      ),
    );
  });

  describe("Family profile", () => {
    it.effect("lets the child start ordinary work but holds an install for the parent code", () =>
      withPreview(
        { packageJson: JSON.stringify({ scripts: { dev: "npx serve ." } }) },
        ({ preview, family, calls }) =>
          Effect.gen(function* () {
            yield* family.enable({ code: CODE, childName: "Ava" });
            const ready = yield* preview.status(THREAD);
            assert.equal(ready.state === "ready" ? ready.decision.kind : null, "grown-up");
            const requestId = ready.state === "ready" ? ready.requestId : "";

            const refused = yield* Effect.flip(
              preview.start({ threadId: THREAD, sessionId: SESSION, approved: true }),
            );
            assert.equal(refused.reason, "needs-grown-up");
            assert.equal(refused.requestId, requestId);
            assert.deepEqual(calls, []);

            // A yes for another session, or another start, does not open this one.
            yield* family.verify({
              code: CODE,
              purpose: "approve",
              sessionId: "session-2",
              requestId,
            });
            yield* family.verify({
              code: CODE,
              purpose: "approve",
              sessionId: SESSION,
              requestId: "skycot-preview:other",
            });
            assert.equal(
              (yield* Effect.flip(
                preview.start({ threadId: THREAD, sessionId: SESSION, approved: true }),
              )).reason,
              "needs-grown-up",
            );

            yield* family.verify({ code: CODE, purpose: "approve", sessionId: SESSION, requestId });
            const started = yield* preview.start({
              threadId: THREAD,
              sessionId: SESSION,
              approved: true,
            });
            assert.equal(started.state, "starting");
          }),
      ),
    );

    it.effect("asks the child (never auto-starts) for an ordinary start", () =>
      withPreview({ packageJson: SITE, runtimeMode: "full-access" }, ({ preview, family }) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: null });
          const ready = yield* preview.status(THREAD);
          assert.equal(ready.state === "ready" ? ready.decision.kind : null, "ask");
          assert.equal(
            (yield* Effect.flip(
              preview.start({ threadId: THREAD, sessionId: SESSION, approved: false }),
            )).reason,
            "needs-approval",
          );
        }),
      ),
    );

    it.effect("keeps the preview on this Mac: the internet needs a grown-up's one-off yes", () =>
      withPreview({ packageJson: SITE }, ({ preview, family }) =>
        Effect.gen(function* () {
          const internet = { sessionId: SESSION, url: "https://example.com/games" };
          assert.deepEqual(yield* preview.checkAddress(internet), { allowed: true });
          yield* family.enable({ code: CODE, childName: null });
          assert.deepEqual(
            yield* preview.checkAddress({ sessionId: SESSION, url: "http://localhost:3000/a" }),
            { allowed: true },
          );
          const refused = yield* preview.checkAddress(internet);
          assert.isFalse(refused.allowed);
          assert.equal(refused.requestId, SkycotPreview.addressRequestId(internet.url));

          yield* family.verify({
            code: CODE,
            purpose: "approve",
            sessionId: SESSION,
            requestId: refused.requestId,
          });
          assert.deepEqual(yield* preview.checkAddress(internet), { allowed: true });
          // Spent: the next visit asks again.
          assert.isFalse((yield* preview.checkAddress(internet)).allowed);
        }),
      ),
    );
  });
});
