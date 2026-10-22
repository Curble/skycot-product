// The live preview: the engine starts a conversation's site and decides which address the plain
// client may show. Starting runs the project's own start script in one of T3's terminals (so a
// grown-up sees it, output and all, in Advanced mode), T3's port scanner links the server it
// opens back to that terminal, and the address shown is always one on this Mac. The person's
// "yes" (or, in the Family profile, the parent code) is checked here, not only on screen.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";

import type { RuntimeMode, TerminalEvent, ThreadId } from "@t3tools/contracts";
import { isLocalPreviewAddress, localAddressFromOutput } from "@t3tools/skycot-rules/preview";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { FetchHttpClient, HttpClient } from "effect/http";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as PortScanner from "../../preview/PortScanner.ts";
import * as TerminalManager from "../../terminal/Manager.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
import {
  findPreviewCommand,
  frameableFromHeaders,
  IDLE_STOP_MS,
  outputTail,
  START_TIMEOUT_MS,
  startDecision,
  type PreviewCommand,
  type PreviewStatus,
} from "./plan.ts";

/** The terminal the preview runs in, one per conversation that started one. */
export const PREVIEW_TERMINAL_ID = "skycot-preview";
const OUTPUT_KEEP = 64 * 1024;
const PROBE_TIMEOUT = Duration.millis(1500);
const SCAN_EVERY_MS = 3_000;

export class SkycotPreviewError extends Schema.TaggedError<SkycotPreviewError>()(
  "SkycotPreviewError",
  {
    reason: Schema.Literals(["needs-approval", "needs-grown-up", "not-startable"]),
    requestId: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "needs-approval":
        return "Starting the preview runs a command, so it needs your OK first.";
      case "needs-grown-up":
        return "The Family profile is on, so a grown-up needs to allow this first.";
      case "not-startable":
        return "This project has nothing to start yet.";
    }
  }
}

export interface AddressAnswer {
  readonly allowed: boolean;
  /** For a grown-up's one-off yes when the address is on the internet. */
  readonly requestId?: string;
}

export class SkycotPreview extends Context.Service<
  SkycotPreview,
  {
    readonly status: (threadId: ThreadId) => Effect.Effect<PreviewStatus>;
    readonly start: (input: {
      readonly threadId: ThreadId;
      readonly sessionId: string;
      /** The person pressed "Start the preview" on the card. */
      readonly approved: boolean;
    }) => Effect.Effect<PreviewStatus, SkycotPreviewError>;
    readonly stop: (threadId: ThreadId) => Effect.Effect<PreviewStatus>;
    /** Whether the preview may go to an address (a link clicked inside it, "Open in browser"). */
    readonly checkAddress: (input: {
      readonly sessionId: string;
      readonly url: string;
    }) => Effect.Effect<AddressAnswer>;
  }
>()("t3/skycot/preview/SkycotPreview") {}

interface Running {
  readonly folder: string;
  readonly ownerThreadId: string;
  readonly command: PreviewCommand;
  readonly port: number;
  readonly startedAt: number;
  output: string;
  exited: boolean;
  url: string | null;
  frameable: boolean;
  failure: "exited" | "no-address" | null;
  lastSeen: number;
  lastScanAt: number;
}

const hashOf = (text: string) =>
  NodeCrypto.createHash("sha256").update(text).digest("hex").slice(0, 20);

/** `approve` grants are keyed by request id: this one names the exact folder and command. */
export const startRequestId = (folder: string, command: PreviewCommand) =>
  `skycot-preview:${hashOf(`${folder}\u0000${command.runner}\u0000${command.script}`)}`;

export const addressRequestId = (url: string) => {
  let origin = url;
  try {
    origin = new URL(url).origin;
  } catch {}
  return `skycot-preview-address:${hashOf(origin)}`;
};

/** A port nothing is listening on, for servers that honour PORT. */
const freePort = Effect.callback<number>((resume) => {
  const server = NodeNet.createServer();
  server.unref();
  server.once("error", () => resume(Effect.succeed(0)));
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    server.close(() => resume(Effect.succeed(port)));
  });
});

export const make = Effect.gen(function* () {
  const terminals = yield* TerminalManager.TerminalManager;
  const ports = yield* PortScanner.PortDiscovery;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const httpClient = (yield* HttpClient.HttpClient).pipe(HttpClient.withScope);
  const family = yield* Effect.serviceOption(SkycotFamily.SkycotFamily);
  const lock = yield* Semaphore.make(1);
  /** Keyed by folder: conversations sharing a folder share its site. */
  const running = new Map<string, Running>();
  const homeDir = NodeOS.homedir();

  const familyOn = Option.isSome(family) ? family.value.isEnabled : Effect.succeed(false);
  const grownUpSaid = (sessionId: string, requestId: string) =>
    Option.isSome(family)
      ? family.value.allows({ sessionId, purpose: "approve", requestId, consume: true })
      : Effect.succeed(true);
  const advancedOpen = (sessionId: string) =>
    Option.isSome(family)
      ? family.value.allows({ sessionId, purpose: "advanced" })
      : Effect.succeed(true);

  const entryFor = (owner: string) => {
    for (const entry of running.values()) if (entry.ownerThreadId === owner) return entry;
    return undefined;
  };

  // Output and exits arrive for every terminal; keep only our own.
  const onTerminalEvent = (event: TerminalEvent) =>
    Effect.sync(() => {
      if (event.terminalId !== PREVIEW_TERMINAL_ID) return;
      const entry = entryFor(event.threadId);
      if (entry === undefined) return;
      if (event.type === "output") {
        entry.output = (entry.output + event.data).slice(-OUTPUT_KEEP);
      } else if (event.type === "exited" || event.type === "closed" || event.type === "error") {
        entry.exited = true;
        entry.failure = "exited";
      }
    });
  yield* Effect.acquireRelease(terminals.subscribe(onTerminalEvent), (unsubscribe) =>
    Effect.sync(unsubscribe),
  );

  /** Where the conversation works, how it runs and how it judges a command. */
  const contextFor = Effect.fn("SkycotPreview.contextFor")(function* (threadId: ThreadId) {
    const thread = yield* projections.getThread(threadId).pipe(Effect.option);
    if (Option.isNone(thread)) return null;
    const project = yield* projects.get(thread.value.projectId).pipe(Effect.option);
    const projectFolder =
      Option.isSome(project) && Option.isSome(project.value)
        ? project.value.value.workspaceRoot
        : null;
    const folder = thread.value.worktreePath ?? projectFolder;
    if (folder === null) return null;
    return {
      folder,
      worktreePath: thread.value.worktreePath,
      projectFolder,
      runtimeMode: thread.value.runtimeMode as RuntimeMode,
    };
  });

  const readStartFiles = Effect.fn("SkycotPreview.readStartFiles")(function* (folder: string) {
    const read = (name: string) =>
      fs.readFileString(path.join(folder, name)).pipe(Effect.orElseSucceed(() => null));
    const lockfiles: Array<string> = [];
    for (const name of ["pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"]) {
      if (yield* fs.exists(path.join(folder, name)).pipe(Effect.orElseSucceed(() => false))) {
        lockfiles.push(name);
      }
    }
    return { packageJson: yield* read("package.json"), t3Json: yield* read("t3.json"), lockfiles };
  });

  /** Answers when anything is serving there; the headers say whether it may be framed. */
  const probe = (url: string) =>
    httpClient.get(url).pipe(
      Effect.map((response) => ({ frameable: frameableFromHeaders(response.headers) })),
      Effect.scoped,
      Effect.timeoutOption(PROBE_TIMEOUT),
      Effect.map(Option.getOrNull),
      // Nothing answering (refused, reset, timed out) just means "not yet".
      Effect.catchCause(() => Effect.succeed(null)),
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
    );

  /** Looks for the started server's address: what it printed, its project file, PORT, the port scan. */
  const findAddress = Effect.fn("SkycotPreview.findAddress")(function* (entry: Running) {
    const now = yield* Clock.currentTimeMillis;
    const candidates = [
      localAddressFromOutput(entry.output),
      entry.command.previewUrl !== null && isLocalPreviewAddress(entry.command.previewUrl)
        ? entry.command.previewUrl
        : null,
      entry.port > 0 ? `http://localhost:${entry.port}/` : null,
    ];
    if (now - entry.lastScanAt >= SCAN_EVERY_MS) {
      entry.lastScanAt = now;
      const servers = yield* ports.scan();
      for (const server of servers) {
        if (
          server.terminal?.threadId === entry.ownerThreadId &&
          server.terminal.terminalId === PREVIEW_TERMINAL_ID &&
          isLocalPreviewAddress(server.url)
        ) {
          candidates.push(server.url);
        }
      }
    }
    for (const url of new Set(candidates)) {
      if (url === null) continue;
      const answer = yield* probe(url);
      if (answer !== null) {
        entry.url = url;
        entry.frameable = answer.frameable;
        return;
      }
    }
    if (now - entry.startedAt > START_TIMEOUT_MS) entry.failure = "no-address";
  });

  const describe = (entry: Running): PreviewStatus => {
    if (entry.failure !== null && (entry.exited || entry.url === null)) {
      return {
        state: "failed",
        command: entry.command,
        reason: entry.failure,
        output: outputTail(entry.output, homeDir),
      };
    }
    if (entry.url !== null) {
      return {
        state: "running",
        command: entry.command,
        url: entry.url,
        frameable: entry.frameable,
      };
    }
    return { state: "starting", command: entry.command, startedAt: entry.startedAt };
  };

  const stopEntry = (entry: Running) =>
    terminals
      .close({ threadId: entry.ownerThreadId, terminalId: PREVIEW_TERMINAL_ID })
      .pipe(
        Effect.ignoreCause({ log: true, message: "Could not stop a preview." }),
        Effect.andThen(Effect.sync(() => running.delete(entry.folder))),
      );

  const statusUnlocked = Effect.fn("SkycotPreview.statusUnlocked")(function* (threadId: ThreadId) {
    const context = yield* contextFor(threadId).pipe(Effect.orElseSucceed(() => null));
    if (context === null) return { state: "no-folder" } satisfies PreviewStatus;
    const entry = running.get(context.folder);
    if (entry !== undefined) {
      entry.lastSeen = yield* Clock.currentTimeMillis;
      if (entry.url === null && entry.failure === null) yield* findAddress(entry);
      return describe(entry);
    }
    const command = findPreviewCommand(yield* readStartFiles(context.folder));
    if (command === null) return { state: "no-site" } satisfies PreviewStatus;
    return {
      state: "ready",
      command,
      decision: startDecision({
        command,
        runtimeMode: context.runtimeMode,
        familyOn: yield* familyOn,
        ctx: { projectRoot: context.folder, projectFolder: context.projectFolder },
      }),
      requestId: startRequestId(context.folder, command),
    } satisfies PreviewStatus;
  });

  const status: SkycotPreview["Service"]["status"] = (threadId) =>
    lock.withPermits(1)(statusUnlocked(threadId));

  const start: SkycotPreview["Service"]["start"] = Effect.fn("SkycotPreview.start")(
    function* (input) {
      return yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const context = yield* contextFor(input.threadId).pipe(Effect.orElseSucceed(() => null));
          const previous = context === null ? undefined : running.get(context.folder);
          // A start that already failed is started afresh; a live one is left as it is.
          if (previous !== undefined && previous.failure !== null) yield* stopEntry(previous);
          const current = yield* statusUnlocked(input.threadId);
          if (current.state !== "ready" || context === null) {
            if (current.state === "no-site" || current.state === "no-folder") {
              return yield* new SkycotPreviewError({ reason: "not-startable" });
            }
            return current;
          }
          const { decision, requestId, command } = current;
          if (decision.kind === "ask" && !input.approved) {
            return yield* new SkycotPreviewError({ reason: "needs-approval", requestId });
          }
          if (
            decision.kind === "grown-up" &&
            !(input.approved && (yield* grownUpSaid(input.sessionId, requestId)))
          ) {
            return yield* new SkycotPreviewError({ reason: "needs-grown-up", requestId });
          }
          const now = yield* Clock.currentTimeMillis;
          const port = yield* freePort;
          const entry: Running = {
            folder: context.folder,
            ownerThreadId: input.threadId,
            command,
            port,
            startedAt: now,
            output: "",
            exited: false,
            url: null,
            frameable: true,
            failure: null,
            lastSeen: now,
            lastScanAt: 0,
          };
          running.set(context.folder, entry);
          const launched = yield* terminals
            .open({
              threadId: input.threadId,
              terminalId: PREVIEW_TERMINAL_ID,
              cwd: context.folder,
              worktreePath: context.worktreePath,
              cols: 120,
              rows: 32,
              env: {
                ...(port > 0 ? { PORT: String(port) } : {}),
                // Dev servers that would open a browser tab of their own stay put.
                BROWSER: "none",
              },
            })
            .pipe(
              // The shell ends with the site, so the terminal's exit is the site's exit.
              Effect.andThen(
                terminals.write({
                  threadId: input.threadId,
                  terminalId: PREVIEW_TERMINAL_ID,
                  data: `${command.runner}; exit\r`,
                }),
              ),
              Effect.as(true),
              Effect.catchCause((cause) =>
                Effect.logWarning("Could not start a preview.", { cause }).pipe(Effect.as(false)),
              ),
            );
          if (!launched) {
            entry.exited = true;
            entry.failure = "exited";
          }
          return describe(entry);
        }),
      );
    },
  );

  const stop: SkycotPreview["Service"]["stop"] = (threadId) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const context = yield* contextFor(threadId).pipe(Effect.orElseSucceed(() => null));
        const entry = context === null ? undefined : running.get(context.folder);
        if (entry !== undefined) yield* stopEntry(entry);
        return yield* statusUnlocked(threadId);
      }),
    );

  const checkAddress: SkycotPreview["Service"]["checkAddress"] = Effect.fn(
    "SkycotPreview.checkAddress",
  )(function* (input) {
    if (isLocalPreviewAddress(input.url) || !(yield* familyOn)) return { allowed: true };
    // The same rule as a typed preview address (SkycotFamilyGate): the internet needs a grown-up.
    if (yield* advancedOpen(input.sessionId)) return { allowed: true };
    const requestId = addressRequestId(input.url);
    if (yield* grownUpSaid(input.sessionId, requestId)) return { allowed: true };
    return { allowed: false, requestId };
  });

  // A preview nobody has looked at for a while is stopped, so sites do not pile up.
  const reapIdle = lock.withPermits(1)(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      // Stopping deletes from the map, which a Map's own iterator tolerates.
      for (const entry of running.values()) {
        if (now - entry.lastSeen > IDLE_STOP_MS) yield* stopEntry(entry);
      }
    }),
  );
  yield* Effect.forkScoped(reapIdle.pipe(Effect.repeat(Schedule.spaced(Duration.minutes(1)))));
  yield* Effect.addFinalizer(() => Effect.forEach(running.values(), stopEntry, { discard: true }));

  return SkycotPreview.of({ status, start, stop, checkAddress });
});

export const layer = Layer.effect(SkycotPreview, make).pipe(
  Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer)),
);
