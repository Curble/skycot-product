// nondev-seam: skycot-mobile-child-copy
export function childErrorCopy(_cause?: unknown): string {
  return "That didn't work just now. Check your Mac is awake, then try again.";
}

export function childLoadingCopy(elapsedMs: number): string | null {
  return elapsedMs >= 12_000 ? "This is taking a little while." : null;
}
