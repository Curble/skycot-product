// nondev-seam: skycot-iphone-q45-face-id-row
export function faceIdRowAction(
  available: boolean,
  everywhere: boolean,
): "settings" | "set-up" | null {
  if (!available) return "settings";
  return everywhere ? null : "set-up";
}
