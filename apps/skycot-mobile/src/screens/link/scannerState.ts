// nondev-seam: skycot-mobile-link-scanner-state
export function scannerMessage(state: {
  readonly granted: boolean;
  readonly canAskAgain: boolean;
  readonly cameraReady: boolean;
  readonly busy: boolean;
}): string {
  if (!state.granted) return state.canAskAgain ? "Camera starting…" : "Camera access is off.";
  if (!state.cameraReady) return "Camera starting…";
  return state.busy ? "Linking…" : "Looking for the code…";
}
