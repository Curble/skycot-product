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

/** The stock developer UI lives at the origin root in every deployment (dev, npx t3, desktop). */
export function advancedModeUrl(): string {
  return `${window.location.origin}/`;
}
