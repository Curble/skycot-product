// nondev-seam: skycot-iphone-q39-home-accessibility
export function accessibleMascotSize(fontScale: number, isPad = false): number {
  return isPad ? 72 : Math.round(Math.min(112, Math.max(72, 72 * fontScale)));
}
