// nondev-seam: skycot-iphone-q39-requests-copy
export function requestCountSentence(count: number): string | null {
  if (count === 0) return null;
  return count === 1 ? "1 request needs a grown-up." : `${count} requests need a grown-up.`;
}

export const NOTIFICATION_INTRO = {
  title: "Get a heads-up",
  message: "SKYCOT can alert you when a child needs help without including what they wrote.",
  button: "Turn on alerts",
} as const;
