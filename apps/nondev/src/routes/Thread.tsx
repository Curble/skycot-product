import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { ConversationView } from "../features/conversation/ConversationView";

export function ThreadRoute({
  environmentId,
  threadId,
  showBack,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly showBack: boolean;
}) {
  return <ConversationView environmentId={environmentId} threadId={threadId} showBack={showBack} />;
}
