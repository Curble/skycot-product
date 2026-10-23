import { describe, expect, it } from "vite-plus/test";

import {
  acceptsLink,
  LinkError,
  modeOf,
  normaliseAddress,
  readLinkInput,
  type MacLink,
} from "./pairing";

const child = (macId: string): MacLink => ({
  macId,
  macName: "MamaBear",
  httpBaseUrl: "http://192.168.1.20:3773",
  me: { kind: "child", deviceId: "d1", deviceName: "Ava's iPad", childId: "c1" },
  linkedAt: 0,
});

describe("reading the Mac's link", () => {
  it("takes the address and the code from the QR code's link", () => {
    expect(
      readLinkInput({
        kind: "scanned",
        text: "http://192.168.1.20:3773/simple/#token=7KQ3M9XD2HPA",
      }),
    ).toEqual({
      httpBaseUrl: "http://192.168.1.20:3773",
      code: "7KQ3M9XD2HPA",
      relay: null,
    });
  });

  it("accepts a typed code in groups, in lower case, and a bare address", () => {
    expect(
      readLinkInput({ kind: "typed", code: "7kq3 m9xd 2hpa", address: "192.168.1.20:3773" }),
    ).toEqual({
      httpBaseUrl: "http://192.168.1.20:3773",
      code: "7KQ3M9XD2HPA",
      relay: null,
    });
  });

  it("says plainly what is wrong", () => {
    const problem = (run: () => unknown) => {
      try {
        run();
      } catch (cause) {
        return cause instanceof LinkError ? cause.problem : "other";
      }
      return null;
    };
    expect(
      problem(() => readLinkInput({ kind: "scanned", text: "https://example.com/menu" })),
    ).toBe("not-a-skycot-code");
    expect(problem(() => readLinkInput({ kind: "typed", code: "1234", address: "x" }))).toBe(
      "code-shape",
    );
    expect(
      problem(() => readLinkInput({ kind: "typed", code: "7KQ3M9XD2HPA", address: " " })),
    ).toBe("address-missing");
    expect(normaliseAddress("ftp://mac.local")).toBeNull();
    expect(normaliseAddress("mac.tailnet.ts.net/")).toBe("http://mac.tailnet.ts.net");
  });
});

describe("what this device is", () => {
  it("is whatever its links say, and one kind only", () => {
    expect(modeOf([])).toBe("unlinked");
    expect(modeOf([child("a")])).toBe("child");
    const grownUp: MacLink = {
      ...child("b"),
      me: { kind: "grown-up", deviceId: "d2", deviceName: "Mum's phone", personId: "p1" },
    };
    expect(acceptsLink([child("a")], child("b"))).toBe(true);
    expect(acceptsLink([child("a")], grownUp)).toBe(false);
  });
});
