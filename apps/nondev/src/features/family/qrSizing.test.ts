import { describe, expect, it } from "vite-plus/test";
import { QrCode } from "@t3tools/shared/qrCode";

// nondev-seam: skycot-family-qr-sizing-test

import { qrImageSize } from "./qrSizing";

describe("QR image sizing", () => {
  it("includes four quiet modules on every side", () => {
    expect(qrImageSize(85)).toBe(93);
  });

  it("uses low correction without automatic boosting for dense links", () => {
    const code = QrCode.encodeText(
      "https://relay.example/simple/#token=" + "A".repeat(330),
      QrCode.Ecc.LOW,
      false,
    );
    expect(code.errorCorrectionLevel).toBe(QrCode.Ecc.LOW);
  });
});
