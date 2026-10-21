import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { History, PanelRightClose } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Columns } from "../../app/useColumns";
import { canOperateEnvironmentAtom } from "../../state/session";
import { environmentThreadShells } from "../../state/threads";
import { IconButton } from "../../ui/Button";
import { InspectorPanel } from "../../ui/InspectorPanel";
import { Sheet } from "../../ui/Sheet";
import { setVersionsRailOpen } from "./railState";
import { VersionsTimeline } from "./VersionsTimeline";

const LEDE = "Every change is a point you can step back to, like Time Machine for this project.";

export type VersionsRailMode = "open" | "strip" | "hidden";

/** What the shell should reserve on the right for the given width and preference. */
export function versionsRailMode(columns: Columns, open: boolean, room: boolean): VersionsRailMode {
  if (columns === 1) return "hidden";
  if (columns === 2 || !room) return "strip";
  return open ? "open" : "strip";
}

/**
 * Everything the shell mounts to the right of a conversation: the full rail at
 * three columns, a thin strip with a toggle when collapsed (and at two columns,
 * where the timeline opens as a sheet instead), and a floating button on a
 * phone. `mode` comes from `versionsRailMode` so the grid and this agree.
 */
export function VersionsRailSlot({
  environmentId,
  threadId,
  mode,
  expandable,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly mode: VersionsRailMode;
  /** True when there is room for the full rail, so the strip's button reopens it rather than a sheet. */
  readonly expandable: boolean;
}) {
  const shell = useAtomValue(environmentThreadShells.threadShellAtom({ environmentId, threadId }));
  const canOperate = useAtomValue(canOperateEnvironmentAtom(environmentId));
  const [sheetOpen, setSheetOpen] = useState(false);
  // Hiding the rail unmounts its Hide button; keyboard focus moves to the
  // strip's Show button instead of falling to the page body.
  const showWrap = useRef<HTMLSpanElement>(null);
  const focusShowNext = useRef(false);
  useEffect(() => {
    if (!focusShowNext.current || mode === "open") return;
    focusShowNext.current = false;
    showWrap.current?.querySelector("button")?.focus();
  }, [mode]);
  const timeline = (
    <VersionsTimeline
      environmentId={environmentId}
      threadId={threadId}
      shell={shell}
      canOperate={canOperate}
    />
  );

  if (mode === "open") {
    return (
      <InspectorPanel label="Versions">
        <div className="fm-versions__head">
          <h3 className="fm-inspector__title">Versions</h3>
          <IconButton
            icon={PanelRightClose}
            label="Hide Versions"
            size="sm"
            onClick={() => {
              focusShowNext.current = true;
              setVersionsRailOpen(false);
            }}
          />
        </div>
        <p className="fm-inspector__lede">{LEDE}</p>
        {timeline}
      </InspectorPanel>
    );
  }

  const openSheetOrRail = () => {
    // Room for the rail and it is collapsed: reopen it. Narrower: the same
    // timeline comes up as a sheet.
    if (expandable) setVersionsRailOpen(true);
    else setSheetOpen(true);
  };
  const button = (
    <span ref={showWrap} style={{ display: "contents" }}>
      <IconButton icon={History} label="Show Versions" onClick={openSheetOrRail} />
    </span>
  );

  return (
    <>
      {mode === "strip" ? (
        <div className="fm-versions-strip" aria-label="Versions">
          {button}
        </div>
      ) : (
        <div className="fm-versions-fab">{button}</div>
      )}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Versions"
        icon={History}
        description={LEDE}
        wide
        actions={null}
      >
        {timeline}
      </Sheet>
    </>
  );
}
