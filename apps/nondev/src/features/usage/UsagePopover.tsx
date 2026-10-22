import { ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

import { describeProviderUsage, updatedPhrase, type ProviderUsage } from "../../plain/usage";
import { UsageRing } from "./UsageRing";
import { localTimeZone, openUsageSheet, useActiveUsage, useGentleUsageRefresh } from "./useUsage";

const OPEN_DELAY_MS = 300;
const CLOSE_DELAY_MS = 200;

/**
 * The glance: a ring beside "Using ChatGPT" showing the share of its allowance left. Hover (after
 * a short pause) or keyboard focus shows the details in a popover; a click opens the Usage sheet
 * for every assistant. On a touch screen, where there is no hover, a tap shows the popover and
 * its "See all assistants…" opens the sheet. The popover never takes focus: Tab moves into its
 * link and out again, Escape or leaving closes it.
 */
export function UsageIndicator() {
  const { environmentId, active } = useActiveUsage();
  const refresh = useGentleUsageRefresh(environmentId);
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointer = useRef<string>("mouse");
  const panelId = useId();
  const open = openedAt !== null;

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = () => {
    clearTimer();
    if (openedAt !== null) return;
    setOpenedAt(Date.now());
    refresh();
  };
  const hide = () => {
    clearTimer();
    setOpenedAt(null);
  };
  const later = (action: () => void, delay: number) => {
    clearTimer();
    timer.current = setTimeout(action, delay);
  };

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  // A tap elsewhere closes a popover opened by tap; mouse users leave it by moving away.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpenedAt(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (active === null) return null;
  const usage = describeProviderUsage(active, openedAt ?? 0, localTimeZone());

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      hide();
    }
  };
  const onBlur = (event: FocusEvent<HTMLSpanElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !anchorRef.current?.contains(next)) hide();
  };

  return (
    <span
      ref={anchorRef}
      className="fm-popover-anchor fm-usage"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") later(show, OPEN_DELAY_MS);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") later(hide, CLOSE_DELAY_MS);
      }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <button
        type="button"
        className="fm-usage__button"
        aria-label={usage.label}
        aria-describedby={open ? panelId : undefined}
        aria-haspopup="dialog"
        onPointerDown={(event) => {
          lastPointer.current = event.pointerType;
        }}
        onFocus={(event) => {
          // Keyboard focus shows the details; a click's focus is handled by the click.
          if (event.currentTarget.matches(":focus-visible")) show();
        }}
        onClick={() => {
          if (lastPointer.current === "touch" || lastPointer.current === "pen") {
            lastPointer.current = "mouse";
            if (open) hide();
            else show();
            return;
          }
          hide();
          openUsageSheet();
        }}
      >
        <UsageRing leftPercent={usage.leftPercent} tone={usage.tone} />
        {usage.leftPercent !== null && usage.tone !== "ok" ? (
          <span className={`fm-usage__figure fm-usage__figure--${usage.tone}`} aria-hidden>
            {usage.leftPercent}%
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={panelId}
          role="group"
          aria-label={`${usage.brand} usage`}
          className="fm-popover fm-popover--bottom-end fm-usage-pop"
          data-sober={usage.tone === "critical" ? "" : undefined}
        >
          <UsagePopoverBody usage={usage} now={openedAt} />
          <button
            type="button"
            className="fm-usage-pop__more"
            onClick={() => {
              hide();
              openUsageSheet();
            }}
          >
            See all assistants…
            <ChevronRight size={13} strokeWidth={1.9} aria-hidden />
          </button>
        </div>
      ) : null}
    </span>
  );
}

function UsagePopoverBody({ usage, now }: { readonly usage: ProviderUsage; readonly now: number }) {
  return (
    <div className="fm-usage-pop__body">
      <div className="fm-usage-pop__head">
        <b>{usage.brand}</b>
        {usage.plan ? <span className="fm-usage-pop__plan">{usage.plan}</span> : null}
      </div>
      {usage.windows.length > 0 ? (
        <ul className="fm-usage-pop__windows">
          {usage.windows.map((window) => (
            <li key={window.id} className="fm-usage-pop__window">
              <span className={`fm-usage-dot fm-usage-dot--${window.tone}`} aria-hidden />
              <span>
                <b>{window.name}:</b> {window.leftPercent}% left
                {window.reset ? (
                  <span className="fm-usage-pop__reset"> · {window.reset}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fm-usage-pop__reason">{usage.reason}</p>
      )}
      {usage.checkedAt !== null && usage.windows.length > 0 ? (
        <p className="fm-usage-pop__updated">
          {updatedPhrase(usage.checkedAt, now, localTimeZone())}
        </p>
      ) : null}
    </div>
  );
}
