// Header button and strip pill for publishing. Both read one `usePublishOverview`
// so the button never says "ready" while the pill says otherwise.
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, OrchestrationV2ThreadProjection, ThreadId } from "@t3tools/contracts";
import { Upload } from "lucide-react";

import { Button } from "../../ui/Button";
import { Pill } from "../../ui/Pill";
import {
  describePublishStatus,
  hasSomethingToPublish,
  publishReadiness,
  type PublishReadiness,
  type PublishStatus,
} from "./model";
import { usePublishData } from "./usePublishData";

export interface PublishOverview {
  readonly readiness: PublishReadiness;
  readonly status: PublishStatus | null;
}

export function usePublishOverview(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly shell: EnvironmentThreadShell | null;
  readonly project: EnvironmentProject | null;
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly active: boolean;
  readonly canOperate: boolean;
}): PublishOverview {
  // Reviewer names only matter while a review is open and unapproved.
  const openSnapshot =
    input.shell?.pullRequests.find((link) => link.snapshot?.state === "open")?.snapshot ?? null;
  const data = usePublishData({
    environmentId: input.environmentId,
    threadId: input.threadId,
    shell: input.shell,
    project: input.project,
    projection: input.projection,
    wantDetail: openSnapshot !== null && openSnapshot.reviewDecision !== "approved",
    wantChanges: false,
  });
  return {
    readiness: publishReadiness({
      vcs: data.vcs,
      link: data.link,
      active: input.active,
      canOperate: input.canOperate && data.canWrite,
    }),
    status: describePublishStatus({
      link: data.link,
      ...(data.detail ? { reviewers: data.detail.reviewers } : {}),
      hasSomethingToPublish: hasSomethingToPublish(data.vcs, data.link),
    }),
  };
}

export function PublishButton({
  readiness,
  onClick,
}: {
  readonly readiness: PublishReadiness;
  readonly onClick: () => void;
}) {
  return (
    <span className="fm-pub-tip" data-tip={readiness.enabled ? undefined : readiness.reason}>
      <Button
        variant="primary"
        size="sm"
        icon={Upload}
        disabled={!readiness.enabled}
        onClick={onClick}
      >
        Publish…
      </Button>
    </span>
  );
}

export function PublishStatusPill({ status }: { readonly status: PublishStatus | null }) {
  if (status === null) return null;
  return (
    <span className="fm-pub-tip" data-tip={status.advanced}>
      <Pill tone={status.tone} size="sm">
        {status.label}
      </Pill>
    </span>
  );
}
