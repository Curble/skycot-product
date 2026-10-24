// "Open it": the page a turn made. Where the conversation's Preview can show it (a plain page
// SKYCOT's own page server shows, on this Mac), it opens there, exactly as the Preview button
// shows it: a real page is several files, and only a web server gives a page its own files the
// way a browser expects. Anywhere else it runs inside SKYCOT in the sealed, offline frame, with
// its own styles, scripts and pictures put inside it (the same frame Quick Look uses). The
// choice is features/starters/preview.ts (openItChoice). Files are read through the engine's
// Files route, so only files inside the project are ever opened, and this works the same in the
// desktop app, a browser on the Mac, or a phone over the network.
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { filesApi, pageWithAssets, type FilesPlace } from "../files/api";
import { fetchPreviewStatus } from "../preview/api";
import { desktopPreviewBridge } from "../preview/DesktopPreviewFrame";
import { previewAddressWorksHere } from "../preview/model";
import { openPreviewAt } from "../preview/store";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { offlinePreviewDocument, openItChoice, PREVIEW_SANDBOX, usesModules } from "./preview";

/** One page to open: the conversation that made it, its project, and its project path. */
export interface OpenItTarget {
  readonly threadId: string;
  readonly projectId: string;
  readonly page: string;
}

/**
 * "Open it" for a screen: `openIt` asks the engine about the conversation's Preview and opens
 * the page there, or in the sealed sheet (`sheet`, to be rendered by the screen).
 */
export function useOpenIt(environmentId: EnvironmentId | null): {
  readonly openIt: (target: OpenItTarget) => void;
  readonly sheet: ReactNode;
} {
  const [sealed, setSealed] = useState<OpenItTarget | null>(null);
  const asking = useRef(false);
  const openIt = useCallback(
    (target: OpenItTarget) => {
      if (environmentId === null || asking.current) return;
      asking.current = true;
      void fetchPreviewStatus(target.threadId)
        .then((answer) => {
          const choice = openItChoice({
            page: target.page,
            status: answer.ok ? answer.status : null,
            canShowPreviewHere: previewAddressWorksHere({
              hasDesktopPreview: desktopPreviewBridge() !== null,
              hostname: window.location.hostname,
            }),
          });
          if (choice.kind === "preview") {
            openPreviewAt(target.threadId, environmentId, choice.path);
          } else {
            setSealed(target);
          }
        })
        .finally(() => {
          asking.current = false;
        });
    },
    [environmentId],
  );
  const sheet =
    sealed === null ? null : (
      <PreviewSheet
        key={`${sealed.threadId}:${sealed.page}`}
        place={{
          projectId: sealed.projectId as ProjectId,
          threadId: sealed.threadId as ThreadId,
        }}
        relativePath={sealed.page}
        onClose={() => setSealed(null)}
      />
    );
  return { openIt, sheet };
}

type Load =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly html: string; readonly truncated: boolean }
  | { readonly state: "problem"; readonly message: string };

/** The sealed, offline frame: the page with its own files inside it. Mounted per page. */
export function PreviewSheet({
  place,
  relativePath,
  onClose,
}: {
  readonly place: FilesPlace;
  readonly relativePath: string;
  readonly onClose: () => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [run, setRun] = useState(0);
  const name = relativePath.split("/").at(-1) ?? relativePath;
  const { projectId, threadId } = place;

  useEffect(() => {
    let cancelled = false;
    const at: FilesPlace = { projectId, threadId };
    void filesApi.read(at, relativePath).then(async (answer) => {
      if (cancelled) return;
      if (!answer.ok) {
        setLoad({ state: "problem", message: answer.message });
        return;
      }
      if (answer.value.encoding !== "utf8" || answer.value.contents === null) {
        setLoad({ state: "problem", message: "This page is too big to open here." });
        return;
      }
      const html = await pageWithAssets(at, answer.value);
      if (!cancelled) setLoad({ state: "ready", html, truncated: answer.value.truncated });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, threadId, relativePath]);

  return (
    <Sheet
      open
      onClose={onClose}
      icon={Play}
      iconTone="blue"
      title={`Open ${name}`}
      description="Running inside SKYCOT, offline: the page can't reach the internet or anything else on this Mac."
      wide
      actions={
        <>
          <Button
            icon={RotateCcw}
            onClick={() => setRun((count) => count + 1)}
            disabled={load.state !== "ready"}
          >
            Start again
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {load.state === "problem" ? (
        <Banner tone="warning">{load.message}</Banner>
      ) : load.state === "loading" ? (
        <p className="fm-help">Opening the page…</p>
      ) : (
        <>
          {load.truncated ? (
            <Banner tone="info">This page is very big, so only the first part is shown.</Banner>
          ) : null}
          {usesModules(load.html) ? (
            <Banner tone="info">
              Some parts of this page may not show here: it's made of files that only work together
              in a browser, like the Preview in SKYCOT on the Mac.
            </Banner>
          ) : null}
          <iframe
            key={run}
            className="fm-preview-frame"
            title={`Preview of ${name}`}
            sandbox={PREVIEW_SANDBOX}
            referrerPolicy="no-referrer"
            srcDoc={offlinePreviewDocument(load.html)}
          />
        </>
      )}
    </Sheet>
  );
}
