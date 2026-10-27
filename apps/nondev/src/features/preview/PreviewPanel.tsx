// "Preview": the conversation's site, running, beside the conversation (a full-screen sheet on
// a phone, or when "Open it" opened it from outside the conversation). "Open it" may ask for one
// page of the site (features/starters/preview.ts); the Preview button shows its first page. The engine starts the site and names the address; starting asks like any command
// in "Ask me first" (in a Family profile, the parent code when the start script installs
// something or uses the internet). Plain controls only: Reload, Open in browser, Close, and
// "Point at something", which turns a click in the page into a chip in the message box.
import {
  ThreadId,
  type EnvironmentId,
  type PreviewAnnotationSubmissionResult,
} from "@t3tools/contracts";
import { reportedPageLink } from "@t3tools/skycot-rules/page-internet";
import { isLocalPreviewAddress, type PreviewProblem } from "@t3tools/skycot-rules/preview";
import {
  AppWindow,
  ExternalLink,
  KeyRound,
  MousePointerClick,
  Play,
  RotateCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";

import { randomUUID } from "~/lib/utils";

import { useCrew } from "../../themes/useCrew";
import { useChildView } from "../../app/useChildView";
import { useConversationShell } from "../../state/oldConversations";
import { PANE_CAPTURE_DELAY_MS, captureMagnetPicture } from "../fridge/capture";
import { previewPageUrl } from "../starters/preview";
import { Banner } from "../../ui/Banner";
import { Button, IconButton } from "../../ui/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../ui/Card";
import { useModal } from "../../ui/useModal";
import { Mascot } from "../brand/Mascot";
import { Disclosure } from "../conversation/cards/Disclosure";
import { useFamily } from "../family/FamilyProvider";
import { isNotTheirsMessage, returnHomeFromOwnershipRefusal } from "../family/ownership";
import { PageInternetAsk } from "../page-internet/PageInternetAsk";
import {
  checkPreviewAddress,
  fetchPreviewStatus,
  startPreview,
  stopPreview,
  type PreviewAnswer,
} from "./api";
import { BrowserPreviewFrame } from "./BrowserPreviewFrame";
import { FullscreenPage } from "./FullscreenPage";
import {
  DesktopPreviewFrame,
  desktopPreviewBridge,
  type FrameControls,
} from "./DesktopPreviewFrame";
import {
  fixItDetails,
  fixItMessage,
  pointerFor,
  previewSurface,
  SET_UP_MESSAGE,
  shortAddress,
  startApproval,
  shouldReload,
  type PreviewStatusView,
} from "./model";
import {
  addPointer,
  closePreview,
  suggestMessage,
  usePreviewPage,
  type PointerDraft,
} from "./store";

/** Polls while the panel is open; running pages need fresh fingerprints. */
function usePreviewAnswer(threadId: string, familyOn: boolean) {
  const [answer, setAnswer] = useState<PreviewAnswer | null>(null);
  const askNow = useRef<(() => void) | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Only the newest question may schedule the next one, so "ask now" never doubles the loop.
    let latest = 0;
    const run = async () => {
      if (timer !== undefined) clearTimeout(timer);
      const mine = ++latest;
      const next = await fetchPreviewStatus(threadId);
      if (!live || mine !== latest) return;
      if (!next.ok && isNotTheirsMessage(next.message)) {
        returnHomeFromOwnershipRefusal(next.message);
        return;
      }
      setAnswer(next);
      // A Family page asks a grown-up soon after it tries the internet (internetAsks).
      const every =
        next.ok && next.status.state === "starting"
          ? 1000
          : next.ok && next.status.state === "running"
            ? 2000
            : 8000;
      timer = setTimeout(run, every);
    };
    askNow.current = () => void run();
    void run();
    return () => {
      live = false;
      askNow.current = null;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [threadId, familyOn]);
  return { answer, setAnswer, refresh: () => askNow.current?.() };
}

/** The chips one pick makes: one per element, or "the part I marked" for a drawn box. */
function draftsFrom(result: PreviewAnnotationSubmissionResult): ReadonlyArray<PointerDraft> {
  const { annotation } = result;
  const picture = annotation.screenshot?.dataUrl ?? null;
  const drafts = annotation.elements.map((target, index) => ({
    id: randomUUID(),
    picture: index === 0 ? picture : null,
    pointer: pointerFor({ ...target.element, rect: target.rect }),
  }));
  if (drafts.length > 0) return drafts;
  if (annotation.regions.length === 0 && annotation.strokes.length === 0) return [];
  const box = annotation.regions[0]?.rect ?? annotation.strokes[0]!.bounds;
  return [
    {
      id: randomUUID(),
      picture,
      pointer: {
        label: "the part I marked",
        pageUrl: annotation.pageUrl,
        tagName: "area",
        selector: null,
        html: `the area ${Math.round(box.width)}×${Math.round(box.height)} px, ${Math.round(box.x)} px from the left and ${Math.round(box.y)} px from the top of the page`,
      },
    },
  ];
}

function openOutside(url: string) {
  const bridge = window.desktopBridge;
  if (bridge) void bridge.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function PreviewPanel({
  environmentId,
  threadId,
  sheet,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  /** A phone: the panel fills the window above everything else. */
  readonly sheet: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useModal(ref, { open: sheet, onClose: closePreview, initialFocus: "first" });
  const content = <PreviewPanelBody environmentId={environmentId} threadId={threadId} ref={ref} />;
  return sheet
    ? createPortal(<div className="fm-preview-sheet">{content}</div>, document.body)
    : content;
}

function PreviewPanelBody({
  environmentId,
  threadId,
  ref,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly ref: Ref<HTMLElement>;
}) {
  const crew = useCrew();
  const builder = crew.builder.name;
  const family = useFamily();
  const childView = useChildView();
  const { shell } = useConversationShell(environmentId, ThreadId.make(threadId));
  const { answer, setAnswer, refresh } = usePreviewAnswer(threadId, family.enabled);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [controls, setControls] = useState<FrameControls | null>(null);
  const [pointing, setPointing] = useState<"idle" | "picking">("idle");
  const [leaving, setLeaving] = useState<{ url: string; requestId?: string } | null>(null);
  /** Internet addresses a grown-up said yes to while this panel is open. */
  const allowedOrigins = useRef(new Set<string>());
  const status = answer?.ok ? answer.status : null;
  const previousStatus = useRef<PreviewStatusView | null>(null);
  const pendingVersionReload = useRef(false);
  const pendingFinishedReload = useRef(false);
  const latestRunFinishedAt = shell?.latestRun?.completedAt ?? null;
  const previousRunFinishedAt = useRef(latestRunFinishedAt);
  const bridge = desktopPreviewBridge();
  const surface =
    status?.state === "running"
      ? previewSurface({
          hasDesktopPreview: bridge !== null,
          page: window.location,
          url: status.url,
          frameable: status.frameable,
        })
      : null;
  const runningUrl = status?.state === "running" ? status.url : null;
  // The page "Open it" asked for, on the running site; the site's own first page otherwise.
  const pageRequest = usePreviewPage(threadId);
  const frameUrl =
    runningUrl === null ? null : previewPageUrl(runningUrl, pageRequest?.path ?? null);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (shouldReload(previous, status)) pendingVersionReload.current = true;
  }, [status]);
  useEffect(() => {
    if (
      pendingVersionReload.current &&
      controls !== null &&
      leaving === null &&
      !(status?.state === "running" && status.internetAsks.length > 0)
    ) {
      pendingVersionReload.current = false;
      controls.reload();
    }
  }, [status, controls, leaving]);
  useEffect(() => {
    const previous = previousRunFinishedAt.current;
    previousRunFinishedAt.current = latestRunFinishedAt;
    if (
      previous !== latestRunFinishedAt &&
      latestRunFinishedAt !== null &&
      status?.state === "running" &&
      status.version === undefined &&
      status.internetAsks.length === 0
    ) {
      pendingFinishedReload.current = true;
    }
  }, [latestRunFinishedAt, status, controls]);
  useEffect(() => {
    if (
      pendingFinishedReload.current &&
      controls !== null &&
      leaving === null &&
      status?.state === "running" &&
      status.internetAsks.length === 0
    ) {
      pendingFinishedReload.current = false;
      controls.reload();
    }
  }, [status, controls, leaving]);
  // A new "Open it" while the site is already showing: go to that page. (A new address reaches
  // the frame by itself; this is for the same address asked for again after clicking around.)
  const askedNonce = useRef(pageRequest?.nonce ?? null);
  const previousFrameUrl = useRef(frameUrl);
  useEffect(() => {
    const sameAddress = previousFrameUrl.current === frameUrl;
    previousFrameUrl.current = frameUrl;
    if (pageRequest === null || pageRequest.nonce === askedNonce.current) return;
    askedNonce.current = pageRequest.nonce;
    if (sameAddress && frameUrl !== null) controls?.navigate(frameUrl);
  }, [pageRequest, frameUrl, controls]);

  const start = async (approved: boolean) => {
    setBusy(true);
    setProblem(null);
    const yes = approved ? startApproval(status) : null;
    let next = await startPreview(threadId, yes !== null, yes?.requestId);
    let cancelled = false;
    if (!next.ok && next.reason === "needs-grown-up" && next.requestId) {
      const allowed = await family.requireParentCode("approve", {
        requestId: next.requestId,
        reason: "Starting this preview needs a grown-up's yes.",
      });
      cancelled = !allowed;
      if (allowed) next = await startPreview(threadId, true, next.requestId);
    }
    setBusy(false);
    // A grown-up who chose Cancel needs no telling; anything else that stopped it is said plainly.
    if (!next.ok && !cancelled) setProblem(next.message);
    if (next.ok) setAnswer(next);
    refresh();
  };

  // "Try again" after a failed start (or "Start it again" after it stopped): clear it and go back
  // through the engine's decision like a first start (the card for "Ask me first", by itself for "Just do it, carefully"). Never a
  // pre-approved start: the start command may have changed since the person last saw it.
  const tryAgain = async () => {
    setBusy(true);
    setProblem(null);
    const next = await stopPreview(threadId);
    autoStarted.current = false;
    setBusy(false);
    if (next.ok) setAnswer(next);
    else setProblem(next.message);
    refresh();
  };

  // "Just do it, carefully" (or hands-off) starts without a question, once per panel.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (status?.state !== "ready" || status.decision.kind !== "start" || autoStarted.current)
      return;
    autoStarted.current = true;
    void start(false);
  });

  // A link inside the child's page: the page server's interceptor stops it and tells us, so the
  // same "That link goes to the internet" card shows here as for the desktop frame.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const url = reportedPageLink(event.data);
      if (url === null || !/^https?:/iu.test(url)) return;
      setLeaving((current) => current ?? { url });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const originOf = (url: string) => {
    try {
      return new URL(url).origin;
    } catch {
      return url;
    }
  };
  const mayLeave = async (
    url: string,
  ): Promise<{ readonly allowed: boolean; readonly requestId?: string }> =>
    isLocalPreviewAddress(url) || allowedOrigins.current.has(originOf(url))
      ? { allowed: true }
      : checkPreviewAddress(url);

  // The page went somewhere on its own (a link clicked inside it). The engine says whether the
  // internet is allowed; in a Family profile it is not without a grown-up, so the page goes back.
  const onNavigated = async (url: string) => {
    if (frameUrl === null) return;
    const answer = await mayLeave(url);
    if (answer.allowed) return;
    controls?.navigate(frameUrl);
    setLeaving({ url, ...(answer.requestId ? { requestId: answer.requestId } : {}) });
  };
  // The Mac app's Preview pane: once the child's own page has loaded and had a moment to paint,
  // a small picture of that tab goes to the page's fridge magnet (the engine keeps one per
  // version of the page; a failure is silent). Never for an error page or a page they clicked on to.
  const captureTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(captureTimer.current), []);
  const onLoaded = (tabId: string, url: string) => {
    const asked = pageRequest?.path;
    if (asked === undefined || !isLocalPreviewAddress(url)) return;
    const base = (path: string) => path.split("/").at(-1) ?? "";
    let loadedPath = "";
    try {
      loadedPath = decodeURIComponent(new URL(url).pathname);
    } catch {
      return;
    }
    if (base(loadedPath) !== base(asked)) return;
    window.clearTimeout(captureTimer.current);
    captureTimer.current = window.setTimeout(() => {
      void captureMagnetPicture({ source: { kind: "tab", tabId }, threadId, page: asked });
    }, PANE_CAPTURE_DELAY_MS);
  };
  const onOpenLink = async (url: string) => {
    const answer = await mayLeave(url);
    if (!answer.allowed) {
      setLeaving({ url, ...(answer.requestId ? { requestId: answer.requestId } : {}) });
      return;
    }
    // A child stays inside SKYCOT; everyone else gets their own browser for the outside world.
    if (isLocalPreviewAddress(url) || family.enabled) controls?.navigate(url);
    else openOutside(url);
  };
  const askToLeave = async () => {
    if (leaving === null) return;
    const target = leaving.url;
    const allowed = leaving.requestId
      ? await family.requireParentCode("approve", {
          requestId: leaving.requestId,
          reason: "This link goes to the internet.",
        })
      : false;
    if (!allowed) return;
    const checked = await checkPreviewAddress(target);
    if (!checked.allowed) return;
    allowedOrigins.current.add(originOf(target));
    setLeaving(null);
    controls?.navigate(target);
  };

  const point = async () => {
    if (!controls?.pick) return;
    if (pointing === "picking") {
      controls.cancelPick?.();
      setPointing("idle");
      return;
    }
    setPointing("picking");
    try {
      const result = await controls.pick();
      if (result) {
        for (const draft of draftsFrom(result)) addPointer(threadId, draft);
        const comment = result.annotation.comment.trim();
        if (comment.length > 0) suggestMessage(threadId, comment, "append");
      }
    } catch {
      // The page went away mid-pick; nothing was chosen.
    } finally {
      setPointing("idle");
    }
  };

  let body: ReactNode;
  if (answer === null) {
    body = <Waiting title="Getting your preview…" />;
  } else if (!answer.ok) {
    body = (
      <div className="fm-preview__notice">
        <Banner
          tone="warning"
          action={
            <Button size="sm" onClick={refresh}>
              Try again
            </Button>
          }
        >
          {childView ? "The preview didn't open just now." : answer.message}
        </Banner>
      </div>
    );
  } else {
    body = (
      <StatusBody
        status={answer.status}
        builder={builder}
        busy={busy}
        onStart={start}
        onTryAgain={() => void tryAgain()}
        onAsk={(text, problem) => suggestMessage(threadId, text, "replace", problem)}
        frame={
          status?.state === "running" && surface !== null && frameUrl !== null ? (
            <RunningFrame
              surface={surface}
              url={frameUrl}
              environmentId={environmentId}
              onControls={setControls}
              onNavigated={(url) => void onNavigated(url)}
              onOpenLink={(url) => void onOpenLink(url)}
              onLoaded={onLoaded}
            />
          ) : null
        }
      />
    );
  }

  const canOpenOutside = frameUrl !== null && surface !== "elsewhere";
  // The picker runs inside T3's preview browser, which only the Mac app has.
  const canPoint = surface === "desktop" && controls?.pick !== undefined;
  const isGame =
    /game/i.test(frameUrl ?? "") ||
    /game/i.test(status?.state === "running" ? status.command.script : "");
  return (
    <FullscreenPage className="fm-preview-fullscreen" game={isGame}>
      <aside className="fm-preview" aria-label="Preview" ref={ref} tabIndex={-1}>
        <header className="fm-preview__bar">
          <span className="fm-preview__title">
            <AppWindow size={15} strokeWidth={1.8} aria-hidden />
            Preview
            {frameUrl && !childView ? (
              <span className="fm-preview__address">{shortAddress(frameUrl)}</span>
            ) : null}
          </span>
          <span className="fm-preview__tools">
            <IconButton
              icon={RotateCw}
              label="Reload"
              size="sm"
              disabled={controls === null}
              onClick={() => controls?.reload()}
            />
            <IconButton
              icon={ExternalLink}
              label="Open in browser"
              size="sm"
              disabled={!canOpenOutside}
              onClick={() => frameUrl && openOutside(frameUrl)}
            />
            <IconButton icon={X} label="Close preview" size="md" onClick={closePreview} />
          </span>
        </header>
        {leaving ? (
          <div className="fm-preview__notice">
            <Banner
              tone="info"
              action={
                <span className="fm-preview__notice-actions">
                  {leaving.requestId ? (
                    <Button size="sm" variant="primary" onClick={() => void askToLeave()}>
                      Ask a grown-up
                    </Button>
                  ) : null}
                  <Button size="sm" onClick={() => setLeaving(null)}>
                    Stay here
                  </Button>
                </span>
              }
            >
              <b>That link goes to the internet</b> ({shortAddress(leaving.url)}). With the Family
              profile on, a grown-up says yes first.
            </Banner>
          </div>
        ) : null}
        {problem ? (
          <div className="fm-preview__notice">
            <Banner
              tone="info"
              action={
                childView ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      suggestMessage(threadId, "Sam, please try opening my page again.", "replace")
                    }
                  >
                    Ask Sam
                  </Button>
                ) : undefined
              }
            >
              {childView ? "The preview didn't open just now." : problem}
            </Banner>
          </div>
        ) : null}
        {status?.state === "running" && status.internetAsks[0] !== undefined ? (
          <PageInternetAsk
            key={`${status.internetAsks[0].page}:${status.internetAsks[0].sites.join(",")}`}
            threadId={threadId}
            page={status.internetAsks[0].page}
            sites={status.internetAsks[0].sites}
            onAllowed={() => {
              controls?.reload();
              refresh();
            }}
          />
        ) : null}
        <div className="fm-preview__body">{body}</div>
        {status?.state === "running" && surface !== "elsewhere" ? (
          <footer className="fm-preview__foot">
            <Button
              size="sm"
              variant={pointing === "picking" ? "primary" : "secondary"}
              icon={MousePointerClick}
              aria-pressed={pointing === "picking"}
              disabled={!canPoint}
              onClick={() => void point()}
            >
              {pointing === "picking" ? "Stop pointing" : "Point at something"}
            </Button>
            <span className="fm-preview__hint" role="status">
              {!canPoint
                ? "Pointing works in the SKYCOT app for Mac. Here, say it in words: “the big pink title”."
                : pointing === "picking"
                  ? childView
                    ? "Click the part you mean, then press Attach."
                    : "Click the part you mean, then press Attach. Esc stops."
                  : `Click a part of your page, then tell ${builder} what to change.`}
            </span>
          </footer>
        ) : null}
      </aside>
    </FullscreenPage>
  );
}

function Waiting({ title, children }: { readonly title: string; readonly children?: ReactNode }) {
  return (
    <div className="fm-preview__state">
      <Mascot pose="thinking" size={72} decorative />
      <p className="fm-preview__state-title">{title}</p>
      {children ? <p className="fm-preview__state-text">{children}</p> : null}
    </div>
  );
}

function StatusBody({
  status,
  builder,
  busy,
  onStart,
  onTryAgain,
  onAsk,
  frame,
}: {
  readonly status: PreviewStatusView;
  readonly builder: string;
  readonly busy: boolean;
  readonly onStart: (approved: boolean) => Promise<void>;
  readonly onTryAgain: () => void;
  /** `problem` is the hidden context a child's message carries (never shown to them). */
  readonly onAsk: (text: string, problem?: PreviewProblem) => void;
  readonly frame: ReactNode;
}) {
  const childView = useChildView();
  switch (status.state) {
    case "no-folder":
      return (
        <div className="fm-preview__state">
          <Mascot pose="hello" size={72} decorative />
          <p className="fm-preview__state-title">Nothing to preview here</p>
          <p className="fm-preview__state-text">
            This conversation isn't working in a project folder.
          </p>
        </div>
      );
    case "no-site":
      return (
        <div className="fm-preview__state">
          <Mascot pose="hello" size={72} decorative />
          <p className="fm-preview__state-title">Nothing to run yet</p>
          <p className="fm-preview__state-text">
            This project doesn't have a page to show yet. {builder} can make one.
          </p>
          <Button variant="primary" onClick={() => onAsk(SET_UP_MESSAGE)}>
            Ask {builder} to set it up
          </Button>
        </div>
      );
    case "ready":
      if (status.decision.kind === "start") return <Waiting title="Starting your preview…" />;
      return <StartCard status={status} busy={busy} onStart={onStart} />;
    case "starting":
      return <Waiting title="Starting your preview…">This usually takes a few seconds.</Waiting>;
    case "failed":
      return (
        <div className="fm-preview__state">
          <Mascot pose="oops" size={72} decorative />
          <p className="fm-preview__state-title">The preview didn't start.</p>
          <p className="fm-preview__state-text">
            {childView
              ? "Sam can take another look."
              : `Ask ${builder} to fix it — the message is written for you.`}
          </p>
          <span className="fm-preview__actions">
            {childView ? (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => onAsk(fixItMessage(status, true), fixItDetails(status))}
              >
                Ask Sam to fix it
              </Button>
            ) : (
              <>
                <Button disabled={busy} onClick={onTryAgain}>
                  Try again
                </Button>
                <Button variant="primary" onClick={() => onAsk(fixItMessage(status, false))}>
                  Ask {builder} to fix it
                </Button>
              </>
            )}
          </span>
          {!childView && status.output.trim().length > 0 ? (
            <div className="fm-preview__said">
              <Disclosure summary="What it said">
                <pre className="fm-preview__output">{status.output}</pre>
              </Disclosure>
            </div>
          ) : null}
        </div>
      );
    case "stopped":
      return (
        <div className="fm-preview__state">
          <Mascot pose="thinking" size={72} decorative />
          <p className="fm-preview__state-title">Your preview stopped.</p>
          <p className="fm-preview__state-text">Start it again?</p>
          <span className="fm-preview__actions">
            <Button
              disabled={busy}
              onClick={() =>
                onAsk(fixItMessage(status, childView), childView ? fixItDetails(status) : undefined)
              }
            >
              {childView ? "Ask Sam to fix it" : `Ask ${builder} why`}
            </Button>
            <Button variant="primary" disabled={busy} onClick={onTryAgain}>
              Start it again
            </Button>
          </span>
          {status.output.trim().length > 0 ? (
            <div className="fm-preview__said">
              <Disclosure summary="What it said">
                <pre className="fm-preview__output">{status.output}</pre>
              </Disclosure>
            </div>
          ) : null}
        </div>
      );
    case "running":
      return frame;
  }
}

function StartCard({
  status,
  busy,
  onStart,
}: {
  readonly status: PreviewStatusView & { readonly state: "ready" };
  readonly busy: boolean;
  readonly onStart: (approved: boolean) => Promise<void>;
}) {
  const childView = useChildView();
  const grownUp = status.decision.kind === "grown-up";
  const reasons = status.decision.kind === "start" ? [] : status.decision.reasons;
  const risky = reasons.length > 0;
  return (
    <div className="fm-preview__card">
      <Card>
        <CardHeader
          icon={grownUp ? KeyRound : risky ? ShieldAlert : Play}
          tone={grownUp || risky ? "orange" : "blue"}
          title={grownUp || childView ? "Ask a grown-up" : "Start the preview?"}
          subtitle={grownUp ? "Family profile" : "Ask me first"}
        />
        <CardBody>
          <p className="fm-preview__card-text">
            {childView
              ? "To see your page, a grown-up needs to say yes."
              : "To show your site, SKYCOT starts it on this Mac by running your project's start command."}
            {risky ? ` Heads up: it ${reasons.join(" and ")}.` : ""}
            {grownUp ? " A grown-up needs to enter the parent code first." : ""}
          </p>
          <Disclosure summary="Show details">
            <pre className="fm-preview__output">
              {status.command.runner}
              {status.command.script !== status.command.runner
                ? `\n→ ${status.command.script}`
                : ""}
            </pre>
          </Disclosure>
        </CardBody>
        <CardFooter>
          <Button onClick={closePreview}>Not now</Button>
          <Button variant="primary" disabled={busy} onClick={() => void onStart(true)}>
            {busy
              ? grownUp || childView
                ? "Waiting for a grown-up…"
                : "Starting…"
              : grownUp || childView
                ? "Ask a grown-up"
                : "Start the preview"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function RunningFrame({
  surface,
  url,
  environmentId,
  onControls,
  onNavigated,
  onOpenLink,
  onLoaded,
}: {
  readonly surface: NonNullable<ReturnType<typeof previewSurface>>;
  readonly url: string;
  readonly environmentId: EnvironmentId;
  readonly onControls: (controls: FrameControls | null) => void;
  readonly onNavigated: (url: string) => void;
  readonly onOpenLink: (url: string) => void;
  readonly onLoaded: (tabId: string, url: string) => void;
}) {
  const bridge = desktopPreviewBridge();
  if (surface === "desktop" && bridge !== null) {
    return (
      <DesktopPreviewFrame
        bridge={bridge}
        environmentId={environmentId}
        url={url}
        onControls={onControls}
        onNavigated={onNavigated}
        onOpenLink={onOpenLink}
        onLoaded={onLoaded}
      />
    );
  }
  if (surface === "frame") return <BrowserPreviewFrame url={url} onControls={onControls} />;
  if (surface === "outside") {
    return (
      <div className="fm-preview__state">
        <Mascot pose="hello" size={72} decorative />
        <p className="fm-preview__state-title">Your site is running</p>
        <p className="fm-preview__state-text">
          It can't be shown inside SKYCOT, so it opens in your browser instead.
        </p>
        <Button variant="primary" icon={ExternalLink} onClick={() => openOutside(url)}>
          Open in browser
        </Button>
      </div>
    );
  }
  return (
    <div className="fm-preview__state">
      <Mascot pose="hello" size={72} decorative />
      <p className="fm-preview__state-title">Your site is running on your Mac</p>
      <p className="fm-preview__state-text">
        Its address only works on the Mac itself. Open SKYCOT there to see it.
      </p>
    </div>
  );
}
