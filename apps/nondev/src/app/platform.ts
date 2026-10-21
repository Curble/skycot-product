// Window-chrome facts the shell needs. Mirrors apps/web/src/lib/windowControlsOverlay.ts
// minimally: on macOS the desktop app hides the title bar and paints the traffic
// lights at x=16 inside a 52px strip, so our title bar leaves room for them; on
// Windows/Linux the overlay buttons sit at the right of the caption strip.
import { isMacPlatform } from "@t3tools/shared/keybindings";

export const isElectron = typeof window !== "undefined" && window.desktopBridge !== undefined;

interface WindowControlsOverlayLike {
  readonly visible: boolean;
  addEventListener(type: "geometrychange", listener: EventListener): void;
  removeEventListener(type: "geometrychange", listener: EventListener): void;
}

function overlay(): WindowControlsOverlayLike | null {
  if (typeof navigator === "undefined") return null;
  return (
    (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayLike })
      .windowControlsOverlay ?? null
  );
}

/** Adds `fm-electron-mac` / `fm-wco` to <html>; apple.css turns them into insets. */
export function applyPlatformClasses(): () => void {
  const root = document.documentElement;
  if (isElectron && isMacPlatform(navigator.platform)) root.classList.add("fm-electron-mac");
  const wco = overlay();
  const update = () => root.classList.toggle("fm-wco", wco !== null && wco.visible);
  update();
  wco?.addEventListener("geometrychange", update);
  return () => wco?.removeEventListener("geometrychange", update);
}

/**
 * Which interface the person last chose. Read by the stock UI's "Back to
 * SKYCOT" link (the `web-back-to-skycot` seam) to know SKYCOT exists at all,
 * and intended for the server's root handler to honour so a relaunch lands in
 * the mode last used.
 */
export const UI_MODE_KEY = "skycot:uiMode";
export type UiMode = "simple" | "advanced";

export function writeUiMode(mode: UiMode) {
  try {
    window.localStorage.setItem(UI_MODE_KEY, mode);
  } catch {
    // Storage blocked: nothing to remember.
  }
}

/**
 * The stock developer UI. In every packaged deployment (npx t3, desktop) it is
 * served at the origin root beside us. Single-origin dev is the one exception:
 * our Vite serves `/simple/` and redirects `/` back to it, while the stock
 * client runs on its own port, which vite.config.ts hands us as a number only
 * (never a baked origin), so remote dev browsers still reach the right host.
 */
export function advancedModeUrl(path = ""): string {
  const { protocol, hostname, origin } = window.location;
  const devPort = import.meta.env.VITE_SKYCOT_DEV_WEB_PORT;
  const base = devPort ? `${protocol}//${hostname}:${devPort}/` : `${origin}/`;
  return `${base}${path.replace(/^\/+/, "")}`;
}

/** Leaves for the developer interface, remembering the choice. */
export function openAdvancedMode(path = ""): void {
  writeUiMode("advanced");
  window.location.assign(advancedModeUrl(path));
}
