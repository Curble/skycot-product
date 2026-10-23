// Quick Look for one file, read-only: pictures large; pages running in the same sandboxed,
// offline frame as "Open it" (with the page's own styles, scripts and pictures put inside it);
// PDFs in the browser's own viewer; Markdown as a document; code and text in a plain monospaced
// view; sounds and videos with their controls (never playing by themselves). Anything else, and
// anything too big, says so plainly; a grown-up can show it in Finder on the Mac.
import { useAtomValue } from "@effect/atom-react";
import { createShellEnvironmentAtoms } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import { isElectron } from "../../app/platform";
import { connectionAtomRuntime } from "../../connection/runtime";
import { serverEnvironment } from "../../state/server";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Sheet } from "../../ui/Sheet";
import { Markdown } from "../conversation/cards/Markdown";
import { offlinePreviewDocument, PREVIEW_SANDBOX } from "../starters/preview";
import { filesApi, type FilesPlace } from "./api";
import { KIND_ICON } from "./icons";
import {
  codeNote,
  entryDetails,
  formatSize,
  inlinePageAssets,
  kindOfEntry,
  pageAssetKey,
  pageAssetRefs,
  type FileRead,
  type FilesEntry,
} from "./model";

const shellCommands = createShellEnvironmentAtoms(connectionAtomRuntime);

type Load =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly file: FileRead; readonly page: string | null }
  | { readonly state: "refused"; readonly message: string };

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A page with its own files inside it, read through the same engine route. */
async function pageWithAssets(place: FilesPlace, file: FileRead): Promise<string> {
  const html = file.contents ?? "";
  const refs = pageAssetRefs(file.path, html);
  const reads = await Promise.all(refs.map((ref) => filesApi.read(place, ref.path)));
  const assets = new Map<string, string>();
  refs.forEach((ref, index) => {
    const answer = reads[index];
    if (!answer?.ok || answer.value.contents === null) return;
    const asset = answer.value;
    if (ref.kind === "picture") {
      if (asset.encoding === "base64") {
        assets.set(pageAssetKey(ref), `data:${asset.mimeType};base64,${asset.contents}`);
      }
    } else if (asset.encoding === "utf8" && !asset.truncated) {
      assets.set(pageAssetKey(ref), asset.contents!);
    }
  });
  return inlinePageAssets(file.path, html, assets);
}

/** Show in Finder only works on the Mac itself, and only when the engine can reveal files. */
function useCanReveal(environmentId: EnvironmentId): boolean {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const local =
    isElectron ||
    (typeof window !== "undefined" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname));
  return local && config?.shellRevealInFileManager === true;
}

export function QuickLook({
  entry,
  now,
  place,
  environmentId,
  grownUpView,
  onClose,
}: {
  readonly entry: FilesEntry;
  readonly now: number;
  readonly place: FilesPlace;
  readonly environmentId: EnvironmentId;
  /**
   * Family off, or a grown-up opened Show everything with the parent code: only then is Show in
   * Finder offered (Finder shows the rest of the Mac). The engine checks the same yes.
   */
  readonly grownUpView: boolean;
  readonly onClose: () => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [run, setRun] = useState(0);
  const [revealProblem, setRevealProblem] = useState<string | null>(null);
  const canReveal = useCanReveal(environmentId) && grownUpView;
  const reveal = useAtomCommand(shellCommands.openInEditor, { reportFailure: false });
  const { projectId, threadId } = place;

  // Mounted afresh for each file (keyed by its path), so it starts out loading.
  useEffect(() => {
    let cancelled = false;
    const at: FilesPlace = { projectId, threadId };
    void filesApi.read(at, entry.path).then(async (answer) => {
      if (cancelled) return;
      if (!answer.ok) {
        setLoad({ state: "refused", message: answer.message });
        return;
      }
      const page =
        answer.value.mode === "page" && answer.value.contents !== null
          ? await pageWithAssets(at, answer.value)
          : null;
      if (!cancelled) setLoad({ state: "ready", file: answer.value, page });
    });
    return () => {
      cancelled = true;
    };
  }, [entry, projectId, threadId]);

  const file = load.state === "ready" ? load.file : null;
  // Pictures, PDFs and media become a local address for this window only, gone on close.
  const objectUrl = useMemo(() => {
    if (file === null || file.encoding !== "base64" || file.contents === null) return null;
    return URL.createObjectURL(new Blob([bytesOf(file.contents)], { type: file.mimeType }));
  }, [file]);
  useEffect(
    () => () => {
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );

  const kind = kindOfEntry(entry);
  const showInFinder =
    canReveal && file !== null
      ? async () => {
          const outcome = await reveal({
            environmentId,
            input: { cwd: file.absolutePath, editor: "file-manager", reveal: true },
          });
          setRevealProblem(outcome._tag === "Failure" ? "Finder didn't open just now." : null);
        }
      : null;

  return (
    <Sheet
      open
      onClose={onClose}
      icon={KIND_ICON[kind]}
      iconTone={kind === "picture" ? "orange" : kind === "page" ? "blue" : "grey"}
      title={entry.name}
      description={entryDetails(entry, now)}
      wide
      actions={
        <>
          {file?.mode === "page" ? (
            <Button icon={RotateCcw} onClick={() => setRun((count) => count + 1)}>
              Start again
            </Button>
          ) : null}
          {showInFinder ? (
            <Button onClick={() => void showInFinder()}>Show in Finder</Button>
          ) : null}
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
      note="Look only: nothing here changes or deletes the file."
    >
      {revealProblem ? <Banner tone="warning">{revealProblem}</Banner> : null}
      {load.state === "loading" ? (
        <p className="fm-help">Opening…</p>
      ) : load.state === "refused" ? (
        <Banner tone="warning">{load.message}</Banner>
      ) : (
        <Body
          file={load.file}
          page={load.page}
          objectUrl={objectUrl}
          run={run}
          canReveal={showInFinder !== null}
        />
      )}
    </Sheet>
  );
}

function Body({
  file,
  page,
  objectUrl,
  run,
  canReveal,
}: {
  readonly file: FileRead;
  readonly page: string | null;
  readonly objectUrl: string | null;
  readonly run: number;
  readonly canReveal: boolean;
}) {
  const elsewhere = canReveal
    ? "Show in Finder opens it on the Mac."
    : "A grown-up can open it from Finder on the Mac.";
  if (file.tooBig) {
    return (
      <EmptyState
        icon={KIND_ICON[kindOfEntry({ name: file.name, kind: "file" })]}
        title="Too big to show here"
      >
        {`This file is ${formatSize(file.size)}. SKYCOT shows pictures, documents and sounds up to 10 MB, and pages up to 2 MB. ${elsewhere}`}
      </EmptyState>
    );
  }
  switch (file.mode) {
    case "picture":
      return objectUrl === null ? null : (
        <div className="fm-ql__picture">
          <img src={objectUrl} alt={file.name} />
        </div>
      );
    case "page":
      return (
        <>
          <p className="fm-help fm-ql__lead">
            Running inside SKYCOT, offline: the page can't reach the internet or anything else on
            this Mac.
          </p>
          <iframe
            key={run}
            className="fm-preview-frame fm-ql__frame"
            title={`Preview of ${file.name}`}
            sandbox={PREVIEW_SANDBOX}
            referrerPolicy="no-referrer"
            srcDoc={offlinePreviewDocument(page ?? file.contents ?? "")}
          />
        </>
      );
    case "pdf":
      // The Mac app has no PDF viewer of its own; the browser's is used where there is one.
      return objectUrl === null ? null : typeof navigator !== "undefined" &&
        navigator.pdfViewerEnabled === false ? (
        <EmptyState icon={KIND_ICON.document} title="This PDF can't open inside SKYCOT here">
          {elsewhere}
        </EmptyState>
      ) : (
        <embed className="fm-ql__pdf" src={objectUrl} type="application/pdf" title={file.name} />
      );
    case "media":
      return objectUrl === null ? null : file.mimeType.startsWith("video/") ? (
        <video className="fm-ql__video" src={objectUrl} controls preload="metadata" />
      ) : (
        <div className="fm-ql__sound">
          <audio src={objectUrl} controls preload="metadata" />
        </div>
      );
    case "markdown":
      return (
        <>
          {file.truncated ? <TruncatedNote /> : null}
          <div className="fm-ql__doc">
            <Markdown text={file.contents ?? ""} />
          </div>
        </>
      );
    case "text": {
      const note = codeNote(file.name);
      return (
        <>
          {note ? <p className="fm-help fm-ql__lead">{note}</p> : null}
          {file.truncated ? <TruncatedNote /> : null}
          <pre className="fm-ql__code" tabIndex={0} aria-label={`The text of ${file.name}`}>
            <code>{file.contents ?? ""}</code>
          </pre>
        </>
      );
    }
    case "none":
      return (
        <EmptyState
          icon={KIND_ICON[kindOfEntry({ name: file.name, kind: "file" })]}
          title="SKYCOT can't show this kind of file"
        >
          {`It's safe where it is. ${elsewhere}`}
        </EmptyState>
      );
  }
}

function TruncatedNote() {
  return <Banner tone="info">This file is very long, so only the first part is shown here.</Banner>;
}
