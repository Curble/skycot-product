// The Mac app's preview: T3's own preview browser (a `<webview>` the desktop shell hardens and
// manages), driven through the desktop bridge. It is what makes "Point at something" possible:
// T3's picker runs inside the page and hands back the element and a picture of it.
import type {
  DesktopPreviewAnnotationTheme,
  DesktopPreviewBridge,
  DesktopPreviewWebviewConfig,
  EnvironmentId,
  PreviewAnnotationSubmissionResult,
} from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { randomUUID } from "~/lib/utils";

export interface FrameControls {
  readonly reload: () => void;
  readonly navigate: (url: string) => void;
  /** Present only where the picker can run (the Mac app, with its picker installed). */
  readonly pick?: () => Promise<PreviewAnnotationSubmissionResult | null>;
  readonly cancelPick?: () => void;
}

interface ElectronWebview extends HTMLElement {
  getWebContentsId: () => number;
}

export function desktopPreviewBridge(): DesktopPreviewBridge | null {
  return typeof window === "undefined" ? null : (window.desktopBridge?.preview ?? null);
}

/** T3's picker drawn in SKYCOT's own colours, read from the live theme's tokens. */
function annotationTheme(): DesktopPreviewAnnotationTheme {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    colorScheme: root.classList.contains("dark") ? "dark" : "light",
    radius: token("--fm-radius-lg", "12px"),
    background: token("--fm-bg-content", "#ffffff"),
    foreground: token("--fm-label", "#1d1d1f"),
    popover: token("--fm-bg-card", "#ffffff"),
    popoverForeground: token("--fm-label", "#1d1d1f"),
    primary: token("--fm-accent", "#0071e3"),
    primaryForeground: token("--fm-on-accent", "#ffffff"),
    muted: token("--fm-bg-fill", "#f2f2f7"),
    mutedForeground: token("--fm-label-2", "#636368"),
    accent: token("--fm-accent-soft", "rgba(0, 113, 227, 0.12)"),
    accentForeground: token("--fm-label", "#1d1d1f"),
    border: token("--fm-sep", "rgba(60, 60, 67, 0.14)"),
    input: token("--fm-sep", "rgba(60, 60, 67, 0.14)"),
    ring: token("--fm-accent", "#0071e3"),
    fontSans: token("--fm-font", "-apple-system, system-ui, sans-serif"),
    fontMono: token("--fm-mono", "ui-monospace, monospace"),
  };
}

export function DesktopPreviewFrame({
  bridge,
  environmentId,
  url,
  onControls,
  onNavigated,
  onOpenLink,
}: {
  readonly bridge: DesktopPreviewBridge;
  readonly environmentId: EnvironmentId;
  /** The address the engine chose; later changes navigate the same tab. */
  readonly url: string;
  readonly onControls: (controls: FrameControls | null) => void;
  /** Every address the page arrives at, so the panel can apply the Family rule. */
  readonly onNavigated: (url: string) => void;
  /** A link that asked for a new window or tab. */
  readonly onOpenLink: (url: string) => void;
}) {
  const [tabId] = useState(() => `skycot-preview-${randomUUID()}`);
  const [config, setConfig] = useState<DesktopPreviewWebviewConfig | null>(null);
  const [initialUrl] = useState(url);
  const created = useRef<Promise<void> | null>(null);
  const webviewRef = useRef<ElectronWebview | null>(null);

  // One main-process tab for the panel's lifetime; the webview attaches to it.
  useEffect(() => {
    const ready = bridge.createTab(tabId, { colorScheme: "light" });
    created.current = ready;
    let live = true;
    void bridge
      .getPreviewConfig(environmentId)
      .then((next) => {
        if (live) setConfig(next);
      })
      .catch(() => {});
    void bridge.setAnnotationTheme(annotationTheme()).catch(() => {});
    return () => {
      live = false;
      void ready.then(() => bridge.closeTab(tabId)).catch(() => {});
    };
  }, [bridge, environmentId, tabId]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (config === null || webview === null) return;
    const register = () => {
      void (created.current ?? Promise.resolve())
        .then(async () => {
          const webContentsId = webview.getWebContentsId();
          if (!Number.isInteger(webContentsId) || webContentsId <= 0) return;
          await bridge.registerWebview(tabId, webContentsId);
          // Only "Attach" in the picker: the message is sent from SKYCOT's own box.
          await bridge.setAnnotationSendEnabled(tabId, false);
        })
        .catch(() => {});
    };
    webview.addEventListener("did-attach", register);
    webview.addEventListener("dom-ready", register);
    return () => {
      webview.removeEventListener("did-attach", register);
      webview.removeEventListener("dom-ready", register);
    };
  }, [bridge, config, tabId]);

  const navigated = useEffectEvent(onNavigated);
  const openLink = useEffectEvent(onOpenLink);
  useEffect(
    () =>
      bridge.onStateChange((changed, state) => {
        if (changed !== tabId || state.navStatus.kind === "Idle") return;
        navigated(state.navStatus.url);
      }),
    [bridge, tabId],
  );
  useEffect(
    () =>
      bridge.onOpenLink((event) => {
        if (event.tabId === tabId) openLink(event.url);
      }),
    [bridge, tabId],
  );

  // The engine chose a new address (a restart on another port): go there.
  const shown = useRef(initialUrl);
  useEffect(() => {
    if (url === shown.current) return;
    shown.current = url;
    void bridge.navigate(tabId, url).catch(() => {});
  }, [bridge, tabId, url]);

  const report = useEffectEvent(onControls);
  useEffect(() => {
    if (config === null) return;
    report({
      reload: () => void bridge.refresh(tabId).catch(() => {}),
      navigate: (next) => void bridge.navigate(tabId, next).catch(() => {}),
      ...(config.preloadUrl
        ? {
            pick: () => bridge.pickElement(tabId),
            cancelPick: () => void bridge.cancelPickElement(tabId).catch(() => {}),
          }
        : {}),
    });
    return () => report(null);
  }, [bridge, config, tabId]);

  if (config === null) return null;
  return (
    <webview
      ref={(node) => {
        webviewRef.current = node as ElectronWebview | null;
      }}
      className="fm-preview__webview"
      // Electron reads these when the guest attaches, so they are attributes, not later calls.
      src={initialUrl}
      partition={config.partition}
      webpreferences={config.webPreferences}
      {...(config.preloadUrl ? { preload: config.preloadUrl } : {})}
      {...({ allowFullScreen: true } as unknown as { readonly allowFullScreen?: boolean })}
      {...({ allowpopups: "true" } as unknown as { readonly allowpopups?: boolean })}
    />
  );
}
