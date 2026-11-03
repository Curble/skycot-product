// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";

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

import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ServerConfig from "../../config.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as PortScanner from "../../preview/PortScanner.ts";
import * as TerminalManager from "../../terminal/Manager.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
// nondev-seam: skycot-project-memory-preview-test
import * as SkycotProjectMemory from "../SkycotProjectMemory.ts";
import { PreviewSandboxCheck } from "./familyContainment.ts";
import { FAMILY_UNCONTAINED_REASON, IDLE_STOP_MS } from "./plan.ts";
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
  /** The engine's T3 home, where the Family sandbox's start files go. */
  readonly engineHome: string;
  /** Every terminal call, in order: "open <cwd> PORT=<n>", "write <data>", "close <thread>". */
  readonly calls: Array<string>;
  readonly setPackageJson: (value: string) => Effect.Effect<void>;
  /** Sends a terminal event as the engine's terminal manager would. */
  readonly emit: (event: TerminalEvent) => Effect.Effect<void>;
  /** Addresses answering, with their headers. */
  readonly serving: Map<string, Record<string, string>>;
}

const withPreview = <A, E>(
  options: {
    readonly packageJson?: string;
    /** Files written into the project folder: { "index.html": "<h1>hi</h1>" }. */
    readonly files?: Readonly<Record<string, string>>;
    readonly runtimeMode?: OrchestrationV2AppThread["runtimeMode"];
    /** Whether this computer can start a site inside the Family sandbox (default: yes). */
    readonly contained?: boolean;
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
    for (const [name, text] of Object.entries(options.files ?? {})) {
      yield* fs.makeDirectory(path.dirname(path.join(folder, name)), { recursive: true });
      yield* fs.writeFileString(path.join(folder, name), text);
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
      SkycotProjectMemory.layerAt(path.join(dir, SkycotProjectMemory.PROJECT_MEMORY_FILE)),
      ServerConfig.layerTest(folder, path.join(dir, "t3")),
      Layer.succeed(PreviewSandboxCheck, () => options.contained ?? true),
      Layer.succeed(HostProcess.Environment, {
        PATH: "/usr/bin:/bin",
        HOME: "/Users/kid",
        GITHUB_TOKEN: "the-parent's-token",
      }),
    );

    return yield* Effect.gen(function* () {
      const preview = yield* SkycotPreview.SkycotPreview;
      const family = yield* SkycotFamily.SkycotFamily;
      return yield* use({
        preview,
        family,
        folder,
        engineHome: path.join(dir, "t3"),
        setPackageJson: (value) =>
          fs.writeFileString(path.join(folder, "package.json"), value).pipe(Effect.orDie),
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

/** A plain page from the preview's own server, read with Node's http as a browser would. */
function getPage(url: string) {
  return new Promise<{ status: number; type: string | null; body: string }>((resolve, reject) => {
    NodeHttp.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (body += chunk));
      response.on("end", () =>
        resolve({
          status: response.statusCode ?? 0,
          type: response.headers["content-type"] ?? null,
          body,
        }),
      );
    }).on("error", reject);
  });
}

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

    it.effect(
      "says a site that was showing and then ended stopped, not that it didn't start (M4)",
      () =>
        withPreview({ packageJson: SITE }, ({ preview, calls, emit, serving }) =>
          Effect.gen(function* () {
            yield* preview.start({ threadId: THREAD, sessionId: SESSION, approved: true });
            yield* emit(output("listening on http://127.0.0.1:4321\n"));
            serving.set("http://127.0.0.1:4321/", {});
            assert.equal((yield* preview.status(THREAD)).state, "running");

            yield* emit(output("Error: something broke\r\n"));
            yield* emit({
              type: "exited",
              threadId: THREAD,
              terminalId: SkycotPreview.PREVIEW_TERMINAL_ID,
              exitCode: 1,
              exitSignal: null,
            });
            const stopped = yield* preview.status(THREAD);
            assert.equal(stopped.state, "stopped");
            assert.include(stopped.state === "stopped" ? stopped.output : "", "something broke");

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

    it.effect("asks again when the start command changed since the person said yes (M3)", () =>
      withPreview({ packageJson: SITE }, ({ preview, folder, calls, emit }) =>
        Effect.gen(function* () {
          const shown = yield* preview.status(THREAD);
          assert.equal(shown.state, "ready");
          const seen = shown.state === "ready" ? shown.requestId : "";
          yield* preview.start({
            threadId: THREAD,
            sessionId: SESSION,
            approved: true,
            requestId: seen,
          });
          yield* emit({
            type: "exited",
            threadId: THREAD,
            terminalId: SkycotPreview.PREVIEW_TERMINAL_ID,
            exitCode: 1,
            exitSignal: null,
          });
          // The assistant changes the start script after the failure.
          yield* FileSystem.FileSystem.pipe(
            Effect.flatMap((fs) =>
              fs.writeFileString(
                `${folder}/package.json`,
                JSON.stringify({ scripts: { dev: "node other.js" } }),
              ),
            ),
            Effect.provide(NodeServices.layer),
            Effect.orDie,
          );

          const retried = yield* Effect.flip(
            preview.start({
              threadId: THREAD,
              sessionId: SESSION,
              approved: true,
              requestId: seen,
            }),
          );
          assert.equal(retried.reason, "needs-approval");
          assert.notEqual(retried.requestId, seen);
          const fresh = yield* preview.status(THREAD);
          assert.equal(fresh.state, "ready");
          assert.equal(fresh.state === "ready" ? fresh.command.runner : "", "npm run dev");
          assert.include(fresh.state === "ready" ? fresh.command.script : "", "other.js");
          // Nothing ran a second time without a fresh yes.
          assert.equal(calls.filter((call) => call.startsWith("write")).length, 1);

          const again = yield* preview.start({
            threadId: THREAD,
            sessionId: SESSION,
            approved: true,
            requestId: fresh.state === "ready" ? fresh.requestId : "",
          });
          assert.equal(again.state, "starting");
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

  describe("a plain web page", () => {
    const KID_SITE = {
      packageJson: JSON.stringify({ dependencies: { three: "^0.186.1" } }),
      files: {
        "index.html": '<script type="module" src="app.mjs"></script>',
        "app.mjs": "await import('./node_modules/three/build/three.module.js');",
        "node_modules/three/build/three.module.js": "export const REVISION = '186';",
        ".env": "SECRET=1",
      },
    };
    const get = (url: string) => Effect.promise(() => getPage(url));

    it.effect("shows index.html itself when nothing starts, with no question and no terminal", () =>
      withPreview({ ...KID_SITE, runtimeMode: "approval-required" }, ({ preview, family, calls }) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: "Ava" });
          const ready = yield* preview.status(THREAD);
          assert.equal(ready.state, "ready");
          assert.equal(ready.state === "ready" ? ready.command.source : null, "static");
          assert.deepEqual(ready.state === "ready" ? ready.decision : null, { kind: "start" });

          const running = yield* preview.start({
            threadId: THREAD,
            sessionId: SESSION,
            approved: false,
          });
          assert.equal(running.state, "running");
          const url = running.state === "running" ? running.url : "";
          assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
          assert.deepEqual(calls, []);

          const page = yield* get(url);
          assert.equal(page.status, 200);
          assert.include(page.body, "app.mjs");
          const three = yield* get(`${url}node_modules/three/build/three.module.js`);
          assert.equal(three.type, "text/javascript; charset=utf-8");
          assert.equal((yield* get(`${url}.env`)).status, 404);
          assert.equal((yield* preview.status(SIBLING)).state, "running");

          // Stopping the preview stops the page server too.
          assert.equal((yield* preview.stop(THREAD)).state, "ready");
          const after = yield* Effect.promise(() =>
            getPage(url).then(
              () => "answered",
              () => "closed",
            ),
          );
          assert.equal(after, "closed");
        }),
      ),
    );

    it.effect("serves public/index.html when that is where the page is", () =>
      withPreview({ files: { "public/index.html": "<h1>hi</h1>" } }, ({ preview }) =>
        Effect.gen(function* () {
          const running = yield* preview.start({
            threadId: THREAD,
            sessionId: SESSION,
            approved: false,
          });
          const url = running.state === "running" ? running.url : "";
          assert.equal((yield* get(url)).body, "<h1>hi</h1>");
          yield* preview.stop(THREAD);
        }),
      ),
    );
  });

  describe("Family profile", () => {
    it.effect("remembers only the grown-up-approved command for this project", () =>
      withPreview(
        { packageJson: JSON.stringify({ scripts: { dev: "npx serve ." } }) },
        ({ preview, family, setPackageJson }) =>
          Effect.gen(function* () {
            yield* family.enable({ code: CODE, childName: "Ava" });
            const first = yield* preview.status(THREAD);
            assert.equal(first.state, "ready");
            if (first.state !== "ready") return;
            yield* family.verify({
              code: CODE,
              purpose: "approve",
              sessionId: SESSION,
              requestId: first.requestId,
            });
            const started = yield* preview.start({
              threadId: THREAD,
              sessionId: SESSION,
              approved: true,
              requestId: first.requestId,
            });
            assert.equal(started.state, "starting");
            yield* preview.stop(THREAD);
            const repeat = yield* preview.status(THREAD);
            assert.equal(repeat.state === "ready" ? repeat.decision.kind : null, "start");
            const unprompted = yield* preview.start({
              threadId: THREAD,
              sessionId: SESSION,
              approved: false,
            });
            assert.equal(unprompted.state, "starting");
            yield* preview.stop(THREAD);

            yield* setPackageJson(JSON.stringify({ scripts: { dev: "npm run serve" } }));
            const changed = yield* preview.status(THREAD);
            assert.equal(changed.state === "ready" ? changed.decision.kind : null, "ask");
            assert.equal(
              (yield* Effect.flip(
                preview.start({ threadId: THREAD, sessionId: SESSION, approved: false }),
              )).reason,
              "needs-approval",
            );
          }),
      ),
    );
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

    it.effect(
      "starts the child's site inside the Family sandbox, with none of the engine's keys",
      () =>
        withPreview({ packageJson: SITE }, ({ preview, family, calls, folder, engineHome }) =>
          Effect.gen(function* () {
            yield* family.enable({ code: CODE, childName: null });
            const ready = yield* preview.status(THREAD);
            assert.equal(ready.state === "ready" ? ready.decision.kind : null, "ask");
            yield* preview.start({ threadId: THREAD, sessionId: SESSION, approved: true });
            const write = calls.find((call) => call.startsWith("write "))!;
            const typed = /^write \/bin\/zsh -f '(.+\/start-[0-9a-f]+\.sh)'; exit\r$/.exec(write);
            assert.isNotNull(typed, write);
            const startFile = typed![1]!;
            assert.isTrue(startFile.startsWith(`${engineHome}/caches/family-sandbox/`));
            const script = NodeFS.readFileSync(startFile, "utf8");
            assert.include(script, "exec /usr/bin/sandbox-exec -f ");
            assert.include(script, "/usr/bin/env -i ");
            assert.include(script, "'PATH=/usr/bin:/bin'");
            assert.include(script, "'GIT_CONFIG_GLOBAL=/dev/null'");
            assert.include(script, "/bin/zsh -f -c 'npm run dev'");
            assert.notInclude(script, "GITHUB_TOKEN");
            const profile = NodeFS.readFileSync(/-f '([^']+\.sb)'/.exec(script)![1]!, "utf8");
            assert.include(profile, "(deny default)");
            const lines = profile.split("\n");
            const real = NodeFS.realpathSync(folder);
            assert.include(
              lines.find((line) => line.startsWith("(allow file-write*")),
              `(subpath "${real}")`,
            );
            assert.include(
              lines.find((line) => line.startsWith("(deny file-write*")),
              `(subpath "${real}/.git")`,
            );
            assert.include(profile, '(allow network-inbound (local ip "localhost:*"))');
            assert.notInclude(profile, "network-outbound");
            // Stopping takes the site's temporary folder away with it.
            const tmpDir = /'TMPDIR=([^']+)'/.exec(script)![1]!;
            assert.isTrue(NodeFS.existsSync(tmpDir));
            yield* preview.stop(THREAD);
            assert.isFalse(NodeFS.existsSync(tmpDir));
          }),
        ),
    );

    it.effect("asks a grown-up when this computer can't keep the site inside the project", () =>
      withPreview({ packageJson: SITE, contained: false }, ({ preview, family, calls }) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: null });
          const ready = yield* preview.status(THREAD);
          assert.deepEqual(ready.state === "ready" ? ready.decision : null, {
            kind: "grown-up",
            reasons: [FAMILY_UNCONTAINED_REASON],
          });
          const requestId = ready.state === "ready" ? ready.requestId : "";
          assert.equal(
            (yield* Effect.flip(
              preview.start({ threadId: THREAD, sessionId: SESSION, approved: true }),
            )).reason,
            "needs-grown-up",
          );
          yield* family.verify({ code: CODE, purpose: "approve", sessionId: SESSION, requestId });
          yield* preview.start({ threadId: THREAD, sessionId: SESSION, approved: true });
          assert.include(calls, "write npm run dev; exit\r");
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
