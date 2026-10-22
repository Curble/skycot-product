// "Open it": the page a turn made, running inside SKYCOT in a sandboxed, offline frame. The
// file is read through the engine (projects.readFile), so this works the same in the desktop
// app, a browser on the Mac, or a phone over the network.
import type { EnvironmentId } from "@t3tools/contracts";
import { Play, RotateCcw } from "lucide-react";
import { useState } from "react";

import { useEnvironmentQuery } from "~/state/query";

import { projectEnvironment } from "../../state/projects";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { offlinePreviewDocument, PREVIEW_SANDBOX } from "./preview";

export function PreviewSheet({
  open,
  onClose,
  environmentId,
  cwd,
  relativePath,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
}) {
  const file = useEnvironmentQuery(
    open ? projectEnvironment.readFile({ environmentId, input: { cwd, relativePath } }) : null,
  );
  const [run, setRun] = useState(0);
  const name = relativePath.split("/").at(-1) ?? relativePath;

  return (
    <Sheet
      open={open}
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
            disabled={!file.data}
          >
            Start again
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {file.error ? (
        <Banner tone="warning">Couldn't open the page just now. Try again in a moment.</Banner>
      ) : file.data === null ? (
        <p className="fm-help">Opening the page…</p>
      ) : file.data.exists === false ? (
        <Banner tone="info">This page isn't there any more — it may have been undone.</Banner>
      ) : (
        <>
          {file.data.truncated ? (
            <Banner tone="info">This page is very big, so only the first part is shown.</Banner>
          ) : null}
          <iframe
            key={run}
            className="fm-preview-frame"
            title={`Preview of ${name}`}
            sandbox={PREVIEW_SANDBOX}
            referrerPolicy="no-referrer"
            srcDoc={offlinePreviewDocument(file.data.contents)}
          />
        </>
      )}
    </Sheet>
  );
}
