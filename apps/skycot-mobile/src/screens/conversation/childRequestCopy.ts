// nondev-seam: skycot-mobile-child-request-copy
/** Plain status for a child while a grown-up answers a held request. */
export function childRequestWaitingCopy(reason: string, waiting: boolean): string | null {
  if (!waiting) return null;
  return `${reason} A grown-up will answer on their phone. This card updates when they do.`;
}
