// Who is who over HTTP: the same rules as the WebSocket gate, for the HTTP routes that read or
// name a conversation, project or folder. Run by SkycotFamilyHttp.layerApiGate (global router
// middleware, no upstream handler changes):
//
// - a removed device is refused every watched route;
// - a grown-up's device may not use Files, previews or badges (it reads conversations and the
//   recap; it does not touch files);
// - a child's own device may only name its own conversations and projects, and the lists it
//   reads over HTTP (the shell snapshot, the projects list) are filtered before they leave.

// Decompressing an answer to filter it is a pure call; Effect has no counterpart.
// @effect-diagnostics nodeBuiltinImport:off
// The answer is re-read as plain JSON of any shape and written back; no schema describes it here.
// @effect-diagnostics preferSchemaOverJson:off
import * as NodeZlib from "node:zlib";

import type { OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpBody, HttpServerResponse } from "effect/http";

import type { FamilyIdentity } from "@t3tools/skycot-rules/people";

import * as SkycotFamilyGate from "../SkycotFamilyGate.ts";
import type * as SkycotFamilyVisibility from "./SkycotFamilyVisibility.ts";
import { filterShellSnapshot } from "./visibility.ts";

/** Routes this file judges for linked devices. */
export function isWatchedPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/orchestration/") ||
    pathname === "/api/projects" ||
    pathname.startsWith("/api/projects/") ||
    pathname.startsWith("/api/skycot/files") ||
    pathname.startsWith("/api/skycot/preview") ||
    pathname.startsWith("/api/skycot/badges")
  );
}

const refusal = (message: string) =>
  HttpServerResponse.jsonUnsafe(
    {
      error: "forbidden",
      message,
      requiredPermission: SkycotFamilyGate.FAMILY_DEVICE_PERMISSION,
    },
    { status: 403, headers: { "cache-control": "no-store" } },
  );

export type DeviceDecision =
  | { readonly type: "refuse"; readonly response: HttpServerResponse.HttpServerResponse }
  | {
      readonly type: "pass";
      /** The answer as this device may see it. */
      readonly transform?: (
        response: HttpServerResponse.HttpServerResponse,
      ) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
    };

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);

/** The JSON inside an answer, whatever compression was applied; null when it can't be read. */
function readJsonBody(response: HttpServerResponse.HttpServerResponse): unknown {
  const body = response.body;
  if (body._tag !== "Uint8Array") return null;
  let bytes: Uint8Array = body.body;
  const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
  try {
    if (encoding === "gzip") bytes = NodeZlib.gunzipSync(bytes);
    else if (encoding === "br") bytes = NodeZlib.brotliDecompressSync(bytes);
    else if (encoding === "deflate") bytes = NodeZlib.inflateSync(bytes);
    else if (encoding !== "" && encoding !== "identity") return null;
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * Rewrites a JSON answer for a child's own device. An answer that can't be read is not passed
 * on: a list the engine cannot filter must not reach the child unfiltered.
 */
const rewriteJson =
  (rewrite: (value: unknown) => Effect.Effect<unknown>) =>
  (response: HttpServerResponse.HttpServerResponse) =>
    Effect.gen(function* () {
      if (response.status < 200 || response.status >= 300) return response;
      const value = readJsonBody(response);
      if (value === null) return refusal(SkycotFamilyGate.CHILD_DEVICE_MESSAGE);
      const next = yield* rewrite(value);
      return HttpServerResponse.setBody(
        response.pipe(
          HttpServerResponse.removeHeader("content-encoding"),
          HttpServerResponse.removeHeader("content-length"),
          HttpServerResponse.removeHeader("etag"),
        ),
        HttpBody.text(JSON.stringify(next), "application/json"),
      );
    });

export const deviceGate: (input: DeviceGateInput) => Effect.Effect<DeviceDecision> = Effect.fn(
  "SkycotFamilyHttp.deviceGate",
)(function* (input: DeviceGateInput): Effect.fn.Return<DeviceDecision> {
  return yield* judge(input);
});

interface DeviceGateInput {
  readonly method: string;
  readonly pathname: string;
  readonly query: URLSearchParams;
  /** The request's JSON body (cached by the request, so the route reads it again). */
  readonly body: Effect.Effect<unknown>;
  readonly who: FamilyIdentity;
  readonly sessionId: string;
  readonly visibility: SkycotFamilyVisibility.SkycotFamilyVisibility["Service"] | null;
}

const judge = Effect.fnUntraced(function* (
  input: DeviceGateInput,
): Effect.fn.Return<DeviceDecision> {
  const pass: DeviceDecision = { type: "pass" };
  const refuse = (message: string): DeviceDecision => ({
    type: "refuse",
    response: refusal(message),
  });
  switch (input.who.kind) {
    case "shared":
      return pass;
    case "removed":
      return refuse(SkycotFamilyGate.REMOVED_DEVICE_MESSAGE);
    case "grown-up":
      return input.pathname.startsWith("/api/skycot/files") ||
        input.pathname.startsWith("/api/skycot/preview") ||
        input.pathname.startsWith("/api/skycot/badges")
        ? refuse(SkycotFamilyGate.GROWN_UP_DEVICE_MESSAGE)
        : pass;
    case "child":
      break;
  }
  if (input.visibility === null) return refuse(SkycotFamilyGate.CHILD_DEVICE_MESSAGE);
  const visibility = input.visibility;
  const view = yield* visibility.childViewFor(input.sessionId);
  if (view === null) return pass;
  const allowed = (
    referenced: Partial<SkycotFamilyVisibility.Referenced>,
    mode: SkycotFamilyVisibility.VisibilityMode,
  ) =>
    visibility.allows(
      view,
      {
        threadIds: referenced.threadIds ?? [],
        projectIds: referenced.projectIds ?? [],
        folders: referenced.folders ?? [],
      },
      mode,
    );
  const judged = (ok: boolean): DeviceDecision =>
    ok ? pass : refuse(SkycotFamilyGate.CHILD_DEVICE_MESSAGE);

  const threadMatch = /^\/api\/orchestration\/threads\/([^/]+)/.exec(input.pathname);
  if (threadMatch !== null) {
    return judged(yield* allowed({ threadIds: [decodeURIComponent(threadMatch[1]!)] }, "use"));
  }
  if (input.pathname === "/api/orchestration/shell") {
    return {
      type: "pass",
      transform: rewriteJson((value) =>
        visibility
          .childViewFor(input.sessionId)
          .pipe(
            Effect.map((fresh) =>
              fresh === null
                ? value
                : filterShellSnapshot(fresh, value as OrchestrationV2ShellSnapshot),
            ),
          ),
      ),
    };
  }
  if (input.pathname.startsWith("/api/orchestration/")) {
    // Any other orchestration read names no single conversation: closed to a child's device.
    return refuse(SkycotFamilyGate.CHILD_DEVICE_MESSAGE);
  }
  if (input.pathname === "/api/projects" && input.method === "GET") {
    return {
      type: "pass",
      transform: rewriteJson((value) =>
        Effect.gen(function* () {
          const snapshot = record(value);
          const projects = Array.isArray(snapshot["projects"]) ? snapshot["projects"] : [];
          const kept: Array<unknown> = [];
          for (const project of projects) {
            const id = text(record(project)["id"]) ?? text(record(project)["projectId"]);
            if (id !== null && (yield* allowed({ projectIds: [id] }, "use"))) kept.push(project);
          }
          return { ...snapshot, projects: kept };
        }),
      ),
    };
  }
  if (input.pathname.startsWith("/api/projects/")) {
    const body = record(yield* input.body);
    const projectId = text(body["projectId"]);
    return judged(projectId === null || (yield* allowed({ projectIds: [projectId] }, "use")));
  }
  if (input.pathname.startsWith("/api/skycot/files")) {
    const projectId = text(input.query.get("projectId"));
    const threadId = text(input.query.get("threadId"));
    return judged(
      yield* allowed(
        {
          projectIds: projectId === null || threadId !== null ? [] : [projectId],
          threadIds: threadId === null ? [] : [threadId],
        },
        "read",
      ),
    );
  }
  if (input.pathname.startsWith("/api/skycot/preview")) {
    const threadId =
      text(input.query.get("threadId")) ??
      (input.method === "POST" ? text(record(yield* input.body)["threadId"]) : null);
    return judged(threadId === null || (yield* allowed({ threadIds: [threadId] }, "use")));
  }
  if (input.pathname.startsWith("/api/skycot/badges") && input.method === "POST") {
    const projectId = text(record(yield* input.body)["projectId"]);
    return judged(projectId === null || (yield* allowed({ projectIds: [projectId] }, "use")));
  }
  return pass;
});
