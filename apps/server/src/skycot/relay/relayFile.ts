// What the Mac remembers about SKYCOT Relay, in `<T3 home>/userdata/skycot-relay.json` (0600):
// whether a grown-up switched it on, and for each linked device the relay id its pass names, the
// tunnel key it first used, its last hello time (replay guard) and its notification references.
// The keys themselves live in T3's secret store. Pure functions here; the service does the I/O.

import * as Schema from "effect/Schema";

import type { Admission } from "@t3tools/skycot-relay/host";

export const RELAY_FILE_NAME = "skycot-relay.json";
/** A relay pass lasts as long as a T3 sign-in (30 days) and is renewed through the tunnel. */
export const PASS_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
/** An unused pass from a link nobody opened is forgotten after this long. */
export const UNUSED_LINK_SECONDS = 24 * 60 * 60;
/** Most relay records one device keeps (old links it never opened). */
const MAX_PER_DEVICE = 4;

const PushRef = Schema.Struct({
  ref: Schema.String,
  type: Schema.Literals(["alert", "liveactivity"]),
});

const RelayDevice = Schema.Struct({
  relayId: Schema.String,
  /** The Family profile's device id (`skycot-family-device:<id>`). */
  familyDeviceId: Schema.String,
  /** The tunnel key the device used first; every later hello must use the same one. */
  key: Schema.NullOr(Schema.String),
  lastTimestamp: Schema.Number,
  createdAt: Schema.Number,
  passExpiresAt: Schema.Number,
  push: Schema.Array(PushRef),
});
export type RelayDevice = typeof RelayDevice.Type;

const RelayFile = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Boolean,
  devices: Schema.Array(RelayDevice),
});
export type RelayFile = typeof RelayFile.Type;

export const EMPTY_RELAY_FILE: RelayFile = { version: 1, enabled: false, devices: [] };

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(RelayFile));
export const encodeRelayFile = Schema.encodeEffect(Schema.fromJsonString(RelayFile));

/** A missing or damaged file reads as "off, nothing linked": the safe way to be wrong. */
export function decodeRelayFile(raw: string): RelayFile {
  const decoded = decode(raw);
  return decoded._tag === "Some" ? decoded.value : EMPTY_RELAY_FILE;
}

/** A new relay record for a device that is being linked (its QR code is on screen). */
export function reserve(
  file: RelayFile,
  input: { readonly relayId: string; readonly familyDeviceId: string; readonly nowSeconds: number },
): RelayFile {
  const mine = file.devices.filter((device) => device.familyDeviceId === input.familyDeviceId);
  // Keep the bound one (if any) and the newest unused ones, within the bound.
  const keep = new Set(
    [...mine]
      .sort(
        (left, right) =>
          Number(right.key !== null) - Number(left.key !== null) ||
          right.createdAt - left.createdAt,
      )
      .slice(0, MAX_PER_DEVICE - 1)
      .map((device) => device.relayId),
  );
  return {
    ...file,
    devices: [
      ...file.devices.filter(
        (device) => device.familyDeviceId !== input.familyDeviceId || keep.has(device.relayId),
      ),
      {
        relayId: input.relayId,
        familyDeviceId: input.familyDeviceId,
        key: null,
        lastTimestamp: 0,
        createdAt: input.nowSeconds,
        passExpiresAt: input.nowSeconds + PASS_LIFETIME_SECONDS,
        push: [],
      },
    ],
  };
}

/**
 * The tunnel's door check, after the Noise handshake proved the device holds `deviceKey`:
 * a relay id this Mac issued, for a device the Family profile still has, the same key as the
 * first time, and a hello newer than the last one (a replayed hello is refused).
 */
export function admit(
  file: RelayFile,
  input: {
    readonly deviceRelayId: string;
    readonly deviceKey: string;
    readonly timestamp: number;
    readonly familyDeviceIds: ReadonlySet<string>;
  },
): { readonly admission: Admission; readonly file: RelayFile } {
  const device = file.devices.find((candidate) => candidate.relayId === input.deviceRelayId);
  const refuse = (reason: string) => ({ admission: { ok: false, reason } as const, file });
  if (!file.enabled) return refuse("SKYCOT Relay is switched off on this Mac.");
  if (device === undefined) return refuse("This Mac did not link that device.");
  if (!input.familyDeviceIds.has(device.familyDeviceId)) return refuse("That device was removed.");
  if (device.key !== null && device.key !== input.deviceKey) {
    return refuse("That device's tunnel key is not the one it linked with.");
  }
  if (input.timestamp <= device.lastTimestamp) return refuse("A replayed hello.");
  const mode = device.key === null ? "pairing" : "linked";
  return {
    admission: { ok: true, mode },
    file: {
      ...file,
      devices: file.devices.map((candidate) =>
        candidate.relayId === device.relayId
          ? { ...candidate, key: input.deviceKey, lastTimestamp: input.timestamp }
          : candidate,
      ),
    },
  };
}

/** Records whose device is gone from the Family profile, or links never used and now old. */
export function vanished(
  file: RelayFile,
  familyDeviceIds: ReadonlySet<string>,
  nowSeconds: number,
): ReadonlyArray<RelayDevice> {
  return file.devices.filter(
    (device) =>
      !familyDeviceIds.has(device.familyDeviceId) ||
      (device.key === null && nowSeconds - device.createdAt > UNUSED_LINK_SECONDS),
  );
}

export function withoutDevices(file: RelayFile, relayIds: ReadonlySet<string>): RelayFile {
  return { ...file, devices: file.devices.filter((device) => !relayIds.has(device.relayId)) };
}

export function updateDevice(
  file: RelayFile,
  relayId: string,
  change: (device: RelayDevice) => RelayDevice,
): RelayFile {
  return {
    ...file,
    devices: file.devices.map((device) => (device.relayId === relayId ? change(device) : device)),
  };
}

/** At most a few references per device and kind: a new one replaces the oldest. */
export function addPushRef(
  device: RelayDevice,
  ref: string,
  type: "alert" | "liveactivity",
): RelayDevice {
  const others = device.push.filter((entry) => entry.ref !== ref);
  const sameType = others.filter((entry) => entry.type === type);
  const kept = sameType.length >= 2 ? others.filter((entry) => entry !== sameType[0]) : others;
  return { ...device, push: [...kept, { ref, type }] };
}
