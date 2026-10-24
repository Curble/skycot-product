// nondev-seam: skycot-approval-lapse-notifications
export interface ApprovalNotificationState {
  readonly requests: ReadonlySet<string>;
  readonly lapsed: ReadonlySet<string>;
}

export interface ApprovalNotificationItem {
  readonly requestId: string;
  readonly lapsed: boolean;
}

/** Which approval transitions deserve a fresh grown-up push. */
export function approvalNotifications(
  pending: ReadonlyArray<ApprovalNotificationItem>,
  announced: ApprovalNotificationState,
) {
  return {
    fresh: pending.filter(
      (request) => !request.lapsed && !announced.requests.has(request.requestId),
    ),
    // Only a lapse seen happening (waiting last look, lapsed now), so a restart never re-nudges
    // about requests that lapsed long ago.
    newlyLapsed: pending.filter(
      (request) =>
        request.lapsed &&
        announced.requests.has(request.requestId) &&
        !announced.lapsed.has(request.requestId),
    ),
  };
}
