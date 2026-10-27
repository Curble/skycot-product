import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
import * as SkycotFamilyVisibility from "../family-devices/SkycotFamilyVisibility.ts";
import * as SkycotFiles from "./SkycotFiles.ts";

const CODE = "482913";
const SESSION = "session-1";
const PROJECT = ProjectId.make("project:pets");
const THREAD = ThreadId.make("thread:pets");
const OTHER_THREAD = ThreadId.make("thread:elsewhere");
const SIBLING_THREAD = ThreadId.make("thread:sibling");
const OWN_THREAD = ThreadId.make("thread:own");

/**
 * A project folder beside a "rest of the disk" folder, with the files a child's project has,
 * the noise a real one collects, and links pointing in and out.
 */
const withFiles = <A, E, R>(
  use: (input: {
    readonly files: SkycotFiles.SkycotFiles["Service"];
    readonly family: SkycotFamily.SkycotFamily["Service"];
    readonly root: string;
    readonly copy: string;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-files-" });
    const root = path.join(dir, "pet-page");
    const copy = path.join(dir, "worktrees", "pet-page-copy");
    const outside = path.join(dir, "rest-of-the-disk");
    for (const folder of [
      root,
      path.join(root, "pictures", "big"),
      path.join(root, "node_modules", "left-pad"),
      path.join(root, ".git"),
      copy,
      outside,
    ]) {
      yield* fs.makeDirectory(folder, { recursive: true });
    }
    const write = (file: string, text: string) => fs.writeFileString(file, text);
    yield* write(path.join(root, "index.html"), "<!doctype html><h1>Bubbles</h1>");
    yield* write(path.join(root, "style.css"), "h1 { color: hotpink; }");
    yield* write(path.join(root, "notes.md"), "# My pet\n");
    yield* fs.writeFile(
      path.join(root, "pictures", "cat.png"),
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]),
    );
    yield* write(path.join(root, "node_modules", "left-pad", "index.js"), "module.exports = 1;");
    yield* write(path.join(root, ".git", "config"), "[core]");
    yield* write(path.join(root, ".env"), "OPENAI_API_KEY=sk-secret");
    yield* write(path.join(root, "letter.docx"), "PK");
    yield* write(path.join(root, "program.txt"), "abc\u0000def");
    yield* write(path.join(root, "long.txt"), "a".repeat(SkycotFiles.TEXT_PREVIEW_BYTES + 10));
    yield* fs.writeFile(
      path.join(root, "pictures", "big", "huge.png"),
      new Uint8Array(SkycotFiles.BINARY_PREVIEW_BYTES + 1),
    );
    yield* write(path.join(outside, "diary.txt"), "private");
    yield* write(path.join(copy, "index.html"), "<h1>Bubbles, in the copy</h1>");
    // Links: one to the rest of the disk, one to a file there, one that stays inside, one broken.
    yield* fs.symlink(outside, path.join(root, "sneaky-folder"));
    yield* fs.symlink(path.join(outside, "diary.txt"), path.join(root, "sneaky.txt"));
    yield* fs.symlink(path.join(root, "notes.md"), path.join(root, "notes-link.md"));
    yield* fs.symlink(path.join(dir, "nowhere"), path.join(root, "broken.txt"));

    const layerStores = Layer.mergeAll(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        get: (projectId) =>
          Effect.succeed(
            projectId === PROJECT
              ? Option.some({ id: projectId, workspaceRoot: root } as never)
              : Option.none(),
          ),
      }),
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThread: (threadId) =>
          threadId === THREAD
            ? Effect.succeed({ projectId: PROJECT, worktreePath: copy, deletedAt: null } as never)
            : threadId === OTHER_THREAD
              ? Effect.succeed({
                  projectId: ProjectId.make("project:other"),
                  worktreePath: outside,
                  deletedAt: null,
                } as never)
              : threadId === SIBLING_THREAD || threadId === OWN_THREAD
                ? Effect.succeed({
                    projectId: PROJECT,
                    worktreePath: copy,
                    deletedAt: null,
                  } as never)
                : Effect.die("no such thread"),
      }),
    );
    const visibility = Layer.mock(SkycotFamilyVisibility.SkycotFamilyVisibility)({
      childViewFor: (sessionId) =>
        Effect.succeed(
          sessionId === "child-device" || sessionId === "shared-mac-child"
            ? {
                childId: "leo",
                owners: {
                  threads: { [String(SIBLING_THREAD)]: "ava", [String(OWN_THREAD)]: "leo" },
                  projects: {},
                },
                pinned: new Set(),
                ...(sessionId === "shared-mac-child" ? { sharedSession: true } : {}),
              }
            : null,
        ),
      allows: (view, referenced) =>
        Effect.succeed(
          referenced.threadIds.every((threadId) => view.owners.threads[threadId] === view.childId),
        ),
      filterShellStream: (_sessionId, stream) => stream,
      filterArchivedStream: (_sessionId, stream) => stream,
    });
    const layerFamily = SkycotFamily.layerAt(path.join(dir, SkycotFamily.FAMILY_FILE_NAME));
    return yield* Effect.gen(function* () {
      const files = yield* SkycotFiles.SkycotFiles;
      const family = yield* SkycotFamily.SkycotFamily;
      return yield* use({ files, family, root, copy });
    }).pipe(
      Effect.provide(
        Layer.effect(SkycotFiles.SkycotFiles, SkycotFiles.make).pipe(
          Layer.provideMerge(Layer.mergeAll(layerStores, layerFamily, visibility)),
        ),
      ),
    );
  }).pipe(Effect.scoped);

const target = (path: unknown, threadId?: ThreadId) => ({
  sessionId: SESSION,
  projectId: PROJECT,
  ...(threadId === undefined ? {} : { threadId }),
  path,
});

const reasonOf = <A>(effect: Effect.Effect<A, SkycotFiles.SkycotFilesError>) =>
  Effect.flip(effect).pipe(Effect.map((error) => error.reason));

it.layer(NodeServices.layer)("SkycotFiles", (it) => {
  it.effect("lists a folder with sizes and times, folders and files, noise flagged", () =>
    withFiles(({ files }) =>
      Effect.gen(function* () {
        const listing = yield* files.list(target(""));
        const byName = new Map(listing.entries.map((entry) => [entry.name, entry]));
        assert.equal(listing.path, "");
        assert.isFalse(listing.privateCopy);
        assert.equal(byName.get("pictures")?.kind, "folder");
        assert.isNull(byName.get("pictures")?.size);
        assert.equal(byName.get("style.css")?.size, "h1 { color: hotpink; }".length);
        assert.isNumber(byName.get("index.html")?.modifiedAt);
        assert.isTrue(byName.get("node_modules")?.noise);
        assert.isTrue(byName.get(".env")?.noise);
        assert.isFalse(byName.get("index.html")?.noise);
        assert.equal(listing.hiddenCount, 0);
        assert.isTrue(listing.noiseIncluded);
        const nested = yield* files.list(target("pictures"));
        assert.deepEqual(
          nested.entries.map((entry) => entry.path),
          ["pictures/big", "pictures/cat.png"],
        );
      }),
    ),
  );

  it.effect("refuses ../, full paths and home paths, inside and out", () =>
    withFiles(({ files }) =>
      Effect.gen(function* () {
        for (const path of [
          "../rest-of-the-disk",
          "pictures/../../rest-of-the-disk/diary.txt",
          "/etc/passwd",
          "~/Documents",
          "pictures\\..\\..\\rest-of-the-disk",
        ]) {
          assert.equal(yield* reasonOf(files.list(target(path))), "outside", path);
          assert.equal(yield* reasonOf(files.read(target(path))), "outside", path);
        }
      }),
    ),
  );

  it.effect("refuses symlinks that point outside the project and leaves them out of lists", () =>
    withFiles(({ files }) =>
      Effect.gen(function* () {
        assert.equal(yield* reasonOf(files.read(target("sneaky.txt"))), "outside");
        assert.equal(yield* reasonOf(files.list(target("sneaky-folder"))), "outside");
        assert.equal(yield* reasonOf(files.read(target("sneaky-folder/diary.txt"))), "outside");
        const names = (yield* files.list(target(""))).entries.map((entry) => entry.name);
        assert.notInclude(names, "sneaky.txt");
        assert.notInclude(names, "sneaky-folder");
        assert.notInclude(names, "broken.txt");
        // A link that stays inside the project is an ordinary file.
        assert.include(names, "notes-link.md");
        const linked = yield* files.read(target("notes-link.md"));
        assert.equal(linked.contents, "# My pet\n");
      }),
    ),
  );

  it.effect("reads the conversation's private copy, and only that project's conversations", () =>
    withFiles(({ files, copy }) =>
      Effect.gen(function* () {
        const listing = yield* files.list(target("", THREAD));
        assert.isTrue(listing.privateCopy);
        assert.isTrue(listing.root.endsWith("pet-page-copy"));
        const page = yield* files.read(target("index.html", THREAD));
        assert.equal(page.contents, "<h1>Bubbles, in the copy</h1>");
        assert.isTrue(page.absolutePath.endsWith(`pet-page-copy/index.html`));
        assert.isTrue(copy.endsWith("pet-page-copy"));
        // A conversation of another project cannot be used to reach its folder.
        assert.equal(yield* reasonOf(files.list(target("", OTHER_THREAD))), "no-project");
        assert.equal(
          yield* reasonOf(
            files.list({ sessionId: SESSION, projectId: ProjectId.make("gone"), path: "" }),
          ),
          "no-project",
        );
      }),
    ),
  );

  // nondev-seam: skycot-files-child-ownership-test
  it.effect("refuses sibling conversation files on a child device and chosen shared Mac", () =>
    withFiles(({ files }) =>
      Effect.gen(function* () {
        for (const sessionId of ["child-device", "shared-mac-child"]) {
          assert.equal(
            yield* reasonOf(
              files.list({ sessionId, projectId: PROJECT, threadId: SIBLING_THREAD, path: "" }),
            ),
            "not-theirs",
          );
          assert.equal(
            (yield* files.list({ sessionId, projectId: PROJECT, threadId: OWN_THREAD, path: "" }))
              .privateCopy,
            true,
          );
        }
      }),
    ),
  );

  it.effect("shows each kind of file its own way, with size caps", () =>
    withFiles(({ files }) =>
      Effect.gen(function* () {
        const picture = yield* files.read(target("pictures/cat.png"));
        assert.equal(picture.mode, "picture");
        assert.equal(picture.encoding, "base64");
        assert.equal(picture.mimeType, "image/png");
        assert.deepEqual(
          [...Buffer.from(picture.contents ?? "", "base64")],
          [0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3],
        );
        const page = yield* files.read(target("index.html"));
        assert.equal(page.mode, "page");
        assert.equal(page.encoding, "utf8");
        const markdown = yield* files.read(target("notes.md"));
        assert.equal(markdown.mode, "markdown");
        const code = yield* files.read(target("style.css"));
        assert.equal(code.mode, "text");
        const unknown = yield* files.read(target("letter.docx"));
        assert.equal(unknown.mode, "none");
        assert.isNull(unknown.contents);
        // Text that is really a program is not shown as text.
        assert.equal((yield* files.read(target("program.txt"))).mode, "none");
        const long = yield* files.read(target("long.txt"));
        assert.isTrue(long.truncated);
        assert.equal(long.contents?.length, SkycotFiles.TEXT_PREVIEW_BYTES);
        const huge = yield* files.read(target("pictures/big/huge.png"));
        assert.isTrue(huge.tooBig);
        assert.isNull(huge.contents);
        assert.equal(yield* reasonOf(files.read(target("pictures"))), "missing");
        assert.equal(yield* reasonOf(files.read(target("gone.html"))), "missing");
        assert.equal(yield* reasonOf(files.list(target("index.html"))), "not-a-folder");
      }),
    ),
  );

  it.effect("with the Family profile on, holds the noise until a grown-up shows everything", () =>
    withFiles(({ files, family }) =>
      Effect.gen(function* () {
        yield* family.enable({ code: CODE, childName: null });
        const listing = yield* files.list(target(""));
        const names = listing.entries.map((entry) => entry.name);
        for (const noise of ["node_modules", ".git", ".env"]) assert.notInclude(names, noise);
        assert.include(names, "index.html");
        assert.equal(listing.hiddenCount, 3);
        assert.isFalse(listing.noiseIncluded);
        assert.equal(yield* reasonOf(files.read(target(".env"))), "hidden");
        assert.equal(yield* reasonOf(files.read(target(".git/config"))), "hidden");
        assert.equal(yield* reasonOf(files.list(target("node_modules"))), "hidden");
        assert.equal(
          yield* reasonOf(files.read(target("node_modules/left-pad/index.js"))),
          "hidden",
        );
        // The child's own work stays open.
        assert.equal((yield* files.read(target("index.html"))).mode, "page");

        yield* family.verify({ code: CODE, purpose: "files", sessionId: SESSION });
        const everything = yield* files.list(target(""));
        assert.isTrue(everything.noiseIncluded);
        assert.equal(everything.hiddenCount, 0);
        assert.include(
          everything.entries.map((entry) => entry.name),
          ".env",
        );
        assert.equal((yield* files.read(target(".env"))).contents, "OPENAI_API_KEY=sk-secret");
        // The yes is this device's only; and ../ stays refused even for a grown-up.
        assert.equal(
          yield* reasonOf(files.read({ ...target(".env"), sessionId: "session-2" })),
          "hidden",
        );
        assert.equal(
          yield* reasonOf(files.read(target("../rest-of-the-disk/diary.txt"))),
          "outside",
        );
        assert.equal(yield* reasonOf(files.read(target("sneaky.txt"))), "outside");
      }),
    ),
  );
});

it("isInsideRoot compares whole folder names", () => {
  assert.isTrue(SkycotFiles.isInsideRoot("/a/pets", "/a/pets", "/"));
  assert.isTrue(SkycotFiles.isInsideRoot("/a/pets", "/a/pets/index.html", "/"));
  assert.isTrue(SkycotFiles.isInsideRoot("/a/pets/", "/a/pets/x", "/"));
  assert.isFalse(SkycotFiles.isInsideRoot("/a/pets", "/a/pets-secret/x", "/"));
  assert.isFalse(SkycotFiles.isInsideRoot("/a/pets", "/a", "/"));
});
