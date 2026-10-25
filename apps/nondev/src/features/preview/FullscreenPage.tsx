import { useEffect, useRef, useState, type ReactNode } from "react";
import { Expand, Minimize } from "lucide-react";

import { useChildView } from "../../app/useChildView";
import { Button } from "../../ui/Button";

/** A page can ask for fullscreen from inside its frame; the parent keeps a calm way back. */
export function FullscreenPage({
  children,
  game = false,
  className,
}: {
  readonly children: ReactNode;
  readonly game?: boolean;
  readonly className?: string;
}) {
  const childView = useChildView();
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(false);
  const [shown, setShown] = useState(true);
  const [hasInternetAsk, setHasInternetAsk] = useState(false);

  useEffect(() => {
    const syncDocument = () => {
      const fullscreen =
        document.fullscreenElement != null &&
        root.current?.contains(document.fullscreenElement) === true;
      setActive(fullscreen);
      if (!fullscreen) setShown(true);
    };
    const syncDesktop = (fullscreen: boolean) => {
      if (fullscreen && root.current?.contains(document.activeElement) !== true) return;
      setActive(fullscreen);
      if (!fullscreen) setShown(true);
    };
    document.addEventListener("fullscreenchange", syncDocument);
    const desktop = window.desktopBridge;
    const off = desktop?.onWindowFullscreenStateChange(syncDesktop);
    if (desktop?.getWindowFullscreenState()) syncDesktop(true);
    const observer = new MutationObserver(() =>
      setHasInternetAsk(root.current?.querySelector(".fm-page-internet") !== null),
    );
    if (root.current) observer.observe(root.current, { childList: true, subtree: true });
    setHasInternetAsk(root.current?.querySelector(".fm-page-internet") !== null);
    return () => {
      document.removeEventListener("fullscreenchange", syncDocument);
      observer.disconnect();
      off?.();
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const reveal = () => setShown(true);

  useEffect(() => {
    if (!active || !shown) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), 2200);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [active, shown]);

  const enter = () => {
    if (window.desktopBridge?.setWindowFullscreen) {
      void window.desktopBridge.setWindowFullscreen(true).catch(() => {});
    } else {
      const request = root.current?.requestFullscreen?.();
      if (request) void request.catch(() => {});
    }
    setActive(true);
    reveal();
  };
  const exit = () => {
    if (document.fullscreenElement != null) void document.exitFullscreen().catch(() => {});
    else if (window.desktopBridge?.setWindowFullscreen)
      void window.desktopBridge.setWindowFullscreen(false).catch(() => {});
    setActive(false);
  };

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      exit();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active]);

  return (
    <div
      ref={root}
      className={`fm-fullscreen-page${active ? " is-fullscreen" : ""}${className ? ` ${className}` : ""}`}
      onMouseMove={active ? reveal : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape" && active) exit();
      }}
    >
      {children}
      {active && hasInternetAsk ? (
        <button className="fm-fullscreen-page__ask" onClick={exit} type="button">
          A page wants the internet · View
        </button>
      ) : null}
      {!active ? (
        <span className="fm-fullscreen-page__enter">
          <Button icon={Expand} size="sm" onClick={enter}>
            {childView && game ? "Play full screen" : "Full screen"}
          </Button>
        </span>
      ) : shown ? (
        <button className="fm-fullscreen-page__exit" onClick={exit} type="button">
          <Minimize size={15} aria-hidden />
          Exit full screen
        </button>
      ) : null}
    </div>
  );
}
