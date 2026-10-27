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

// nondev-seam: skycot-playable-copy
import { filesApi, pageWithAssets, playablePage, type FilesPlace } from "../files/api";
import { fetchPreviewStatus } from "../preview/api";
import { desktopPreviewBridge } from "../preview/DesktopPreviewFrame";
import { previewAddressWorksHere } from "../preview/model";
import { openPreviewAt } from "../preview/store";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { openItChoice, useOfflinePreviewDocument, usesModules } from "./preview";
import { Mascot } from "../brand/Mascot";
import { useChildView } from "../../app/useChildView";
import { isNotTheirsMessage, returnHomeFromOwnershipRefusal } from "../family/ownership";
import { PageInternetAsk } from "../page-internet/PageInternetAsk";
import { useSealedInternet } from "../page-internet/useSealedInternet";
import { FullscreenPage } from "../preview/FullscreenPage";
import { SealedPreviewFrame } from "../preview/SealedPreviewFrame";
import { CAPTURE_DELAY_MS, captureMagnetPicture } from "../fridge/capture";

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
  | {
      readonly state: "ready";
      readonly html: string;
      readonly truncated: boolean;
      // nondev-seam: skycot-playable-copy
      readonly engineCopy: boolean;
      /** The page's path on the Mac: what a grown-up's internet yes is kept for. */
      readonly absolutePath: string;
    }
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
  const [frameLoaded, setFrameLoaded] = useState(false);
  const childView = useChildView();
  const frame = useRef<HTMLIFrameElement>(null);
  const internet = useSealedInternet(load.state === "ready" ? load.absolutePath : null, frame);
  const sealedDocument = useOfflinePreviewDocument(
    load.state === "ready" ? load.html : "",
    internet.allowed,
    internet.enabled,
  );
  const name = relativePath.split("/").at(-1) ?? relativePath;
  const { projectId, threadId } = place;

  // Once the page has had a moment to paint, the Mac app takes a small picture of this frame
  // for the page's fridge magnet (desktop only; it does nothing, quietly, anywhere else).
  const captureTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(captureTimer.current), []);
  const onFrameLoaded = () => {
    setFrameLoaded(true);
    if (threadId === null) return;
    window.clearTimeout(captureTimer.current);
    captureTimer.current = window.setTimeout(() => {
      void captureMagnetPicture({ frame: frame.current, threadId, page: relativePath });
    }, CAPTURE_DELAY_MS);
  };

  // The page as last read: when Sam changes the file while the sheet is open, the frame reloads
  // by itself (checked every few seconds) so the child never wonders whether anything happened.
  const lastSeen = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const at: FilesPlace = { projectId, threadId };
    const read = async (watching: boolean) => {
      const answer = await filesApi.read(at, relativePath);
      if (cancelled) return;
      if (!answer.ok) {
        if (isNotTheirsMessage(answer.message)) {
          returnHomeFromOwnershipRefusal(answer.message);
          return;
        }
        if (!watching) setLoad({ state: "problem", message: answer.message });
        return;
      }
      if (answer.value.encoding !== "utf8" || answer.value.contents === null) {
        if (!watching) setLoad({ state: "problem", message: "This page is too big to open here." });
        return;
      }
      // nondev-seam: skycot-playable-copy
      const engineHtml = await playablePage(at.threadId, answer.value.absolutePath);
      const html = engineHtml ?? (await pageWithAssets(at, answer.value));
      // The packed page holds the page's own files too, so a change to any of them shows up here.
      if (cancelled || (watching && html === lastSeen.current)) return;
      lastSeen.current = html;
      setLoad({
        state: "ready",
        html,
        truncated: answer.value.truncated,
        // nondev-seam: skycot-playable-copy
        engineCopy: engineHtml !== null,
        absolutePath: answer.value.absolutePath,
      });
      if (watching) {
        setFrameLoaded(false);
        setRun((count) => count + 1);
      }
    };
    void read(false);
    const timer = window.setInterval(() => void read(true), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectId, threadId, relativePath]);

  return (
    <Sheet
      open
      onClose={onClose}
      icon={Play}
      iconTone="blue"
      title={
        childView ? (/game/i.test(name) ? "Play your game" : "Look at your page") : `Open ${name}`
      }
      description="Running inside SKYCOT, offline: the page can't reach the internet or anything else on this Mac."
      wide
      actions={
        <>
          <Button
            icon={RotateCcw}
            onClick={() => {
              setFrameLoaded(false);
              setRun((count) => count + 1);
            }}
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
          {usesModules(load.html) && !load.engineCopy ? (
            <Banner tone="info">
              Some parts of this page may not show here: it's made of files that only work together
              in a browser, like the Preview in SKYCOT on the Mac.
            </Banner>
          ) : null}
          <FullscreenPage game={/game/i.test(name)} className="fm-sealed-fullscreen">
            {internet.link !== null ? (
              <div className="fm-preview-notice">
                <Banner
                  tone="info"
                  action={
                    <Button size="sm" onClick={internet.clearLink}>
                      Stay here
                    </Button>
                  }
                >
                  That link goes to the internet. With the Family profile on, a grown-up says yes
                  first.
                </Banner>
              </div>
            ) : null}
            {load.state === "ready" && threadId !== null && internet.asks.length > 0 ? (
              <PageInternetAsk
                key={internet.asks.join(",")}
                threadId={threadId}
                page={load.absolutePath}
                sites={internet.asks}
                onAllowed={() => setRun((count) => count + 1)}
              />
            ) : null}
            <div className="fm-preview-frame-wrap">
              {!frameLoaded ? (
                <div className="fm-preview-frame-loading">
                  <Mascot pose="thinking" size={56} decorative />
                  <p>Getting it ready…</p>
                </div>
              ) : null}
              <SealedPreviewFrame
                key={run}
                frameRef={frame}
                className="fm-preview-frame"
                title={`Preview of ${name}`}
                srcDoc={sealedDocument}
                onLoad={onFrameLoaded}
              />
            </div>
          </FullscreenPage>
        </>
      )}
    </Sheet>
  );
}
