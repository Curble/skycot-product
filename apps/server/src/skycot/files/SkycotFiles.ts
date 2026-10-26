// Files and Quick Look, engine side: list a folder of one SKYCOT project and read one file of it
// for the plain client's Files view. Read-only: nothing here writes, moves or deletes.
//
// The engine picks the folder from the project (or the conversation's private copy), never from
// the client, and every path is relative to it. A path is cleaned first (no `..`, no leading `/`
// or `~`), then resolved to its real place on disk, so a symlink pointing outside the project is
// refused like a typed `../`. Entries whose real place is outside are left out of a listing.
//
// While the Family profile is on, noise (hidden and secret files, installed add-ons, build
// output) is left out and refused unless a grown-up opened "Show everything" with the parent
// code (the `files` grant). Everything else in a SKYCOT project is open to the child, siblings'
// projects included, as their conversations are.
import type { ProjectId, ThreadId } from "@t3tools/contracts";

import * as SkycotFamilyVisibility from "../family-devices/SkycotFamilyVisibility.ts";
import {
  cleanBrowsePath,
  isNoiseName,
  mimeTypeOf,
  pathHasNoise,
  quickLookModeOf,
  type QuickLookMode,
} from "@t3tools/skycot-rules/browse";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as SkycotFamily from "../SkycotFamily.ts";

/** A listing stops here; a folder this full is not one a person browses by eye. */
export const MAX_LIST_ENTRIES = 2000;
/** Text, code and Markdown: the first part is shown beyond this. */
export const TEXT_PREVIEW_BYTES = 512 * 1024;
/** Pages run whole or not at all: half a page is a broken page. */
export const PAGE_PREVIEW_BYTES = 2 * 1024 * 1024;
/** Pictures, PDFs, sounds and videos travel whole, as base64, up to this. */
export const BINARY_PREVIEW_BYTES = 10 * 1024 * 1024;

export class SkycotFilesError extends Schema.TaggedError<SkycotFilesError>()("SkycotFilesError", {
  reason: Schema.Literals([
    "no-project",
    "outside",
    "missing",
    "hidden",
    "not-a-folder",
    "not-theirs",
  ]),
}) {
  override get message(): string {
    switch (this.reason) {
      case "no-project":
        return "SKYCOT can't find that project any more.";
      case "outside":
        return "That's outside the project, so SKYCOT won't open it here.";
      case "missing":
        return "That file isn't there any more. It may have been moved or undone.";
      case "hidden":
        return "That's one of the project's hidden files. A grown-up can show everything with the parent code.";
      case "not-theirs":
        return "That's not yours to open.";
      case "not-a-folder":
        return "That isn't a folder.";
    }
  }
}

export interface FilesEntry {
  readonly name: string;
  /** Project-relative, with forward slashes. */
  readonly path: string;
  readonly kind: "folder" | "file";
  /** Bytes; null for folders. */
  readonly size: number | null;
  /** Epoch ms; null when the disk does not say. */
  readonly modifiedAt: number | null;
  /** Hidden, secret, add-on or build output: behind "Show everything". */
  readonly noise: boolean;
}

export interface FilesListing {
  /** The folder on this Mac the paths are relative to, for "Show in Finder". */
  readonly root: string;
  /** Whether `root` is the conversation's private copy rather than the project's own folder. */
  readonly privateCopy: boolean;
  readonly path: string;
  readonly entries: ReadonlyArray<FilesEntry>;
  /** Noise left out because the Family profile is on and nobody opened Show everything. */
  readonly hiddenCount: number;
  /** Whether noise is in `entries` (flagged), so the client's Show everything switch can show it. */
  readonly noiseIncluded: boolean;
  readonly truncated: boolean;
}

export interface FileRead {
  readonly name: string;
  readonly path: string;
  readonly mode: QuickLookMode;
  readonly mimeType: string;
  readonly size: number;
  readonly modifiedAt: number | null;
  /** `utf8` for text and pages, `base64` for pictures, PDFs and media, null when not sent. */
  readonly encoding: "utf8" | "base64" | null;
  readonly contents: string | null;
  /** Only the first part of a long text came. */
  readonly truncated: boolean;
  /** Too big to preview at all; nothing came. */
  readonly tooBig: boolean;
  /** Where it lives on this Mac, for "Show in Finder". */
  readonly absolutePath: string;
}

export interface FilesTarget {
  readonly sessionId: string;
  readonly projectId: ProjectId;
  /** The conversation whose private copy to read; the project's own folder without one. */
  readonly threadId?: ThreadId | undefined;
  readonly path: unknown;
}

export class SkycotFiles extends Context.Service<
  SkycotFiles,
  {
    readonly list: (input: FilesTarget) => Effect.Effect<FilesListing, SkycotFilesError>;
    readonly read: (input: FilesTarget) => Effect.Effect<FileRead, SkycotFilesError>;
  }
>()("t3/skycot/files/SkycotFiles") {}

/** Pure: whether `target` is `root` or inside it. Both are real paths from the same disk. */
export function isInsideRoot(root: string, target: string, separator: string): boolean {
  const base = root.endsWith(separator) ? root.slice(0, -1) : root;
  return target === base || target.startsWith(`${base}${separator}`);
}

/** Text that is really a binary file (a NUL in its first part) is not shown as text. */
function looksBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 8000);
  for (let index = 0; index < end; index += 1) if (bytes[index] === 0) return true;
  return false;
}

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const visibility = yield* Effect.serviceOption(SkycotFamilyVisibility.SkycotFamilyVisibility);
  const projects = yield* ProjectStore.ProjectStoreV2;
  const family = yield* Effect.serviceOption(SkycotFamily.SkycotFamily);

  /** Whether noise may be seen: always outside the Family profile, else with a grown-up's yes. */
  const noiseAllowed = (sessionId: string) =>
    Option.isNone(family)
      ? Effect.succeed(true)
      : family.value.isEnabled.pipe(
          Effect.flatMap((enabled) =>
            enabled ? family.value.allows({ sessionId, purpose: "files" }) : Effect.succeed(true),
          ),
          Effect.orElseSucceed(() => false),
        );

  /** The project's folder, or the conversation's private copy, as its real path. */
  const rootFor = Effect.fn("SkycotFiles.rootFor")(function* (input: FilesTarget) {
    const project = yield* projects
      .get(input.projectId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(project)) return yield* new SkycotFilesError({ reason: "no-project" });
    // A child (their own device, or the shared Mac with them chosen) opens only what is theirs:
    // a sibling's conversation and its files stay closed, exactly as the engine's other doors.
    if (Option.isSome(visibility)) {
      const view = yield* visibility.value.childViewFor(input.sessionId);
      if (
        view !== null &&
        !(yield* visibility.value.allows(
          view,
          SkycotFamilyVisibility.referencedBy({
            projectId: input.projectId,
            ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
          }),
          "read",
        ))
      ) {
        yield* Effect.logInfo("skycot-files.refused", { reason: "not-theirs" });
        return yield* new SkycotFilesError({ reason: "not-theirs" });
      }
    }
    let folder = project.value.workspaceRoot;
    let privateCopy = false;
    if (input.threadId !== undefined) {
      const thread = yield* projections
        .getThread(input.threadId)
        .pipe(Effect.orElseSucceed(() => null));
      if (thread === null || thread.projectId !== input.projectId || thread.deletedAt !== null) {
        return yield* new SkycotFilesError({ reason: "no-project" });
      }
      if (thread.worktreePath !== null) {
        folder = thread.worktreePath;
        privateCopy = true;
      }
    }
    const root = yield* fs
      .realPath(folder)
      .pipe(Effect.mapError(() => new SkycotFilesError({ reason: "no-project" })));
    return { root, privateCopy };
  });

  /** The real place of a cleaned project path, refused when it lands outside the project. */
  const resolve = Effect.fn("SkycotFiles.resolve")(function* (root: string, raw: unknown) {
    const relative = cleanBrowsePath(raw);
    if (relative === null) return yield* new SkycotFilesError({ reason: "outside" });
    const real = yield* fs
      .realPath(relative === "" ? root : path.join(root, ...relative.split("/")))
      .pipe(Effect.mapError(() => new SkycotFilesError({ reason: "missing" })));
    if (!isInsideRoot(root, real, path.sep)) {
      yield* Effect.logInfo("skycot-files.refused", { reason: "outside" });
      return yield* new SkycotFilesError({ reason: "outside" });
    }
    return { relative, real };
  });

  const modifiedOf = (info: FileSystem.File.Info) =>
    Option.match(info.mtime, { onNone: () => null, onSome: (date) => date.getTime() });

  const list: SkycotFiles["Service"]["list"] = Effect.fn("SkycotFiles.list")(function* (input) {
    const { root, privateCopy } = yield* rootFor(input);
    const { relative, real } = yield* resolve(root, input.path);
    const mayShowNoise = yield* noiseAllowed(input.sessionId);
    if (!mayShowNoise && pathHasNoise(relative, true)) {
      return yield* new SkycotFilesError({ reason: "hidden" });
    }
    const info = yield* fs
      .stat(real)
      .pipe(Effect.mapError(() => new SkycotFilesError({ reason: "missing" })));
    if (info.type !== "Directory") return yield* new SkycotFilesError({ reason: "not-a-folder" });
    const names = yield* fs
      .readDirectory(real)
      .pipe(Effect.mapError(() => new SkycotFilesError({ reason: "missing" })));
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    const entries: Array<FilesEntry> = [];
    let hiddenCount = 0;
    let truncated = false;
    for (const name of sorted) {
      if (entries.length >= MAX_LIST_ENTRIES) {
        truncated = true;
        break;
      }
      const full = path.join(real, name);
      // A link is listed only when its real place is inside the project; a broken one is not.
      const target = yield* fs.realPath(full).pipe(Effect.orElseSucceed(() => null));
      if (target === null || !isInsideRoot(root, target, path.sep)) continue;
      const stat = yield* fs.stat(target).pipe(Effect.orElseSucceed(() => null));
      if (stat === null) continue;
      const folder = stat.type === "Directory";
      if (stat.type !== "Directory" && stat.type !== "File") continue;
      const noise = isNoiseName(name, folder);
      if (noise && !mayShowNoise) {
        hiddenCount += 1;
        continue;
      }
      entries.push({
        name,
        path: relative === "" ? name : `${relative}/${name}`,
        kind: folder ? "folder" : "file",
        size: folder ? null : Number(stat.size),
        modifiedAt: modifiedOf(stat),
        noise,
      });
    }
    return {
      root,
      privateCopy,
      path: relative,
      entries,
      hiddenCount,
      noiseIncluded: mayShowNoise,
      truncated,
    };
  });

  const read: SkycotFiles["Service"]["read"] = Effect.fn("SkycotFiles.read")(function* (input) {
    const { root } = yield* rootFor(input);
    const { relative, real } = yield* resolve(root, input.path);
    if (relative === "") return yield* new SkycotFilesError({ reason: "missing" });
    if (pathHasNoise(relative, false) && !(yield* noiseAllowed(input.sessionId))) {
      yield* Effect.logInfo("skycot-files.refused", { reason: "hidden" });
      return yield* new SkycotFilesError({ reason: "hidden" });
    }
    const info = yield* fs
      .stat(real)
      .pipe(Effect.mapError(() => new SkycotFilesError({ reason: "missing" })));
    if (info.type !== "File") return yield* new SkycotFilesError({ reason: "missing" });
    const name = relative.split("/").at(-1) ?? relative;
    const size = Number(info.size);
    const base = {
      name,
      path: relative,
      mimeType: mimeTypeOf(name),
      size,
      modifiedAt: modifiedOf(info),
      absolutePath: real,
    };
    let mode = quickLookModeOf(name);
    if (mode === "none") {
      return { ...base, mode, encoding: null, contents: null, truncated: false, tooBig: false };
    }
    const binary = mode === "picture" || mode === "pdf" || mode === "media";
    const cap = binary ? BINARY_PREVIEW_BYTES : mode === "page" ? PAGE_PREVIEW_BYTES : null;
    if (cap !== null && size > cap) {
      return { ...base, mode, encoding: null, contents: null, truncated: false, tooBig: true };
    }
    const limit = cap ?? TEXT_PREVIEW_BYTES;
    const bytes = yield* Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fs.open(real, { flag: "r" });
        const chunk = yield* file.readAlloc(Math.min(size, limit));
        return Option.getOrElse(chunk, () => new Uint8Array(0));
      }),
    ).pipe(Effect.mapError(() => new SkycotFilesError({ reason: "missing" })));
    if (binary) {
      return {
        ...base,
        mode,
        encoding: "base64" as const,
        contents: Buffer.from(bytes).toString("base64"),
        truncated: false,
        tooBig: false,
      };
    }
    if (looksBinary(bytes)) mode = "none";
    if (mode === "none") {
      return { ...base, mode, encoding: null, contents: null, truncated: false, tooBig: false };
    }
    return {
      ...base,
      mode,
      encoding: "utf8" as const,
      // A cut can land inside a character; the decoder shows a replacement mark there.
      contents: new TextDecoder("utf-8").decode(bytes),
      truncated: size > bytes.length,
      tooBig: false,
    };
  });

  return SkycotFiles.of({ list, read });
});

/** Needs `SkycotFamily` from above when the profile should apply (the server provides it). */
export const layer = Layer.effect(SkycotFiles, make).pipe(
  Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer)),
);
