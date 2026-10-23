import { describe, expect, it } from "vite-plus/test";

import {
  addPushRef,
  admit,
  decodeRelayFile,
  EMPTY_RELAY_FILE,
  reserve,
  UNUSED_LINK_SECONDS,
  vanished,
  type RelayFile,
} from "./relayFile.ts";

const on: RelayFile = { ...EMPTY_RELAY_FILE, enabled: true };
const ids = new Set(["ava-ipad", "mum-phone"]);

describe("the Mac's relay records", () => {
  it("admit a linked device with its own key and a newer hello only", () => {
    const file = reserve(on, { relayId: "r1", familyDeviceId: "ava-ipad", nowSeconds: 100 });
    const first = admit(file, {
      deviceRelayId: "r1",
      deviceKey: "K1",
      timestamp: 10,
      familyDeviceIds: ids,
    });
    expect(first.admission).toEqual({ ok: true, mode: "pairing" });

    const again = admit(first.file, {
      deviceRelayId: "r1",
      deviceKey: "K1",
      timestamp: 11,
      familyDeviceIds: ids,
    });
    expect(again.admission).toEqual({ ok: true, mode: "linked" });

    expect(
      admit(again.file, {
        deviceRelayId: "r1",
        deviceKey: "K1",
        timestamp: 11,
        familyDeviceIds: ids,
      }).admission.ok,
    ).toBe(false);
    expect(
      admit(again.file, {
        deviceRelayId: "r1",
        deviceKey: "K2",
        timestamp: 12,
        familyDeviceIds: ids,
      }).admission,
    ).toEqual({
      ok: false,
      reason: "That device's tunnel key is not the one it linked with.",
    });
  });

  it("refuse a relay id this Mac never issued, a removed device, and everything while off", () => {
    const file = reserve(on, { relayId: "r1", familyDeviceId: "ava-ipad", nowSeconds: 100 });
    expect(
      admit(file, { deviceRelayId: "r9", deviceKey: "K", timestamp: 1, familyDeviceIds: ids })
        .admission.ok,
    ).toBe(false);
    expect(
      admit(file, {
        deviceRelayId: "r1",
        deviceKey: "K",
        timestamp: 1,
        familyDeviceIds: new Set(["mum-phone"]),
      }).admission.ok,
    ).toBe(false);
    expect(
      admit(
        { ...file, enabled: false },
        { deviceRelayId: "r1", deviceKey: "K", timestamp: 1, familyDeviceIds: ids },
      ).admission.ok,
    ).toBe(false);
  });

  it("forget removed devices and links nobody opened", () => {
    let file = reserve(on, { relayId: "r1", familyDeviceId: "ava-ipad", nowSeconds: 100 });
    file = admit(file, {
      deviceRelayId: "r1",
      deviceKey: "K",
      timestamp: 1,
      familyDeviceIds: ids,
    }).file;
    file = reserve(file, { relayId: "r2", familyDeviceId: "mum-phone", nowSeconds: 100 });
    file = reserve(file, { relayId: "r3", familyDeviceId: "gone", nowSeconds: 100 });
    expect(vanished(file, ids, 200).map((device) => device.relayId)).toEqual(["r3"]);
    expect(
      vanished(file, ids, 100 + UNUSED_LINK_SECONDS + 1).map((device) => device.relayId),
    ).toEqual(["r2", "r3"]);
  });

  it("keep a device's linked record when it is linked again, within a bound", () => {
    let file = reserve(on, { relayId: "bound", familyDeviceId: "ava-ipad", nowSeconds: 1 });
    file = admit(file, {
      deviceRelayId: "bound",
      deviceKey: "K",
      timestamp: 1,
      familyDeviceIds: ids,
    }).file;
    for (let index = 0; index < 6; index += 1) {
      file = reserve(file, {
        relayId: `new${index}`,
        familyDeviceId: "ava-ipad",
        nowSeconds: 10 + index,
      });
    }
    const mine = file.devices.map((device) => device.relayId);
    expect(mine).toContain("bound");
    expect(mine).toContain("new5");
    expect(mine.length).toBe(4);
  });

  it("keep two notification references per kind, newest last", () => {
    const [device] = reserve(on, {
      relayId: "r1",
      familyDeviceId: "ava-ipad",
      nowSeconds: 1,
    }).devices;
    const one = addPushRef(device!, "a", "alert");
    const two = addPushRef(one, "b", "alert");
    const three = addPushRef(addPushRef(two, "c", "alert"), "live", "liveactivity");
    expect(three.push).toEqual([
      { ref: "b", type: "alert" },
      { ref: "c", type: "alert" },
      { ref: "live", type: "liveactivity" },
    ]);
  });

  it("read a damaged file as off", () => {
    expect(decodeRelayFile("{not json")).toEqual(EMPTY_RELAY_FILE);
    expect(
      decodeRelayFile(JSON.stringify({ version: 1, enabled: true, devices: [] })).enabled,
    ).toBe(true);
  });
});
