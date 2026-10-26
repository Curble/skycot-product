// nondev-seam: skycot-family-qr-sizing
/** Adds the QR standard's four-module quiet zone on each side. */
export function qrImageSize(modules: number): number {
  return modules + 8;
}
