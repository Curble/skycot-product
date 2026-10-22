import { describe, expect, it } from "vite-plus/test";

import {
  civilTwilight,
  coordinatesForTimeZone,
  phaseAt,
  phaseAtLocation,
  wallClock,
  zonedTime,
} from "./daylight.ts";

const TOLERANCE_MS = 10 * 60_000;
const at = (iso: string) => new Date(iso);

function expectNear(actual: Date, expectedIso: string) {
  const delta = Math.abs(actual.getTime() - at(expectedIso).getTime());
  expect(delta, `${actual.toISOString()} vs ${expectedIso}`).toBeLessThanOrEqual(TOLERANCE_MS);
}

/**
 * Reference civil twilight (sun 6° below the horizon) from the sunrise-sunset.org API
 * (https://api.sunrise-sunset.org/json?lat=…&lng=…&date=…&formatted=0&tzid=…), fetched 22 Oct 2026
 * at each zone's zone.tab city coordinates. The 22 Oct rows also match the brand guide's worked
 * example (Melbourne 05:59 → 20:11, London 07:02 → 18:28, New York 06:47 → 18:34).
 * Offsets are written out, so each row also pins the DST state of that local day.
 */
const REFERENCE: ReadonlyArray<{
  readonly name: string;
  readonly zone: string;
  readonly night: string;
  readonly noon: string;
  readonly dawn: string;
  readonly dusk: string;
}> = [
  {
    name: "Melbourne, summer",
    zone: "Australia/Melbourne",
    night: "2026-01-15T03:00:00+11:00",
    noon: "2026-01-15T13:00:00+11:00",
    dawn: "2026-01-15T05:44:28+11:00",
    dusk: "2026-01-15T21:14:18+11:00",
  },
  {
    name: "Melbourne, winter",
    zone: "Australia/Melbourne",
    night: "2026-07-15T03:00:00+10:00",
    noon: "2026-07-15T12:00:00+10:00",
    dawn: "2026-07-15T07:03:52+10:00",
    dusk: "2026-07-15T17:48:21+10:00",
  },
  {
    name: "Melbourne, the day daylight saving ends (5 Apr)",
    zone: "Australia/Melbourne",
    night: "2026-04-05T04:00:00+10:00",
    noon: "2026-04-05T12:00:00+10:00",
    dawn: "2026-04-05T06:11:14+10:00",
    dusk: "2026-04-05T18:34:38+10:00",
  },
  {
    name: "Melbourne, the day daylight saving starts (4 Oct)",
    zone: "Australia/Melbourne",
    night: "2026-10-04T04:00:00+11:00",
    noon: "2026-10-04T12:00:00+11:00",
    dawn: "2026-10-04T06:24:52+11:00",
    dusk: "2026-10-04T19:53:02+11:00",
  },
  {
    name: "Melbourne, brand guide example",
    zone: "Australia/Melbourne",
    night: "2026-10-22T03:00:00+11:00",
    noon: "2026-10-22T12:00:00+11:00",
    dawn: "2026-10-22T05:58:13+11:00",
    dusk: "2026-10-22T20:11:05+11:00",
  },
  {
    name: "Sydney",
    zone: "Australia/Sydney",
    night: "2026-10-22T03:00:00+11:00",
    noon: "2026-10-22T12:00:00+11:00",
    dawn: "2026-10-22T05:39:40+11:00",
    dusk: "2026-10-22T19:39:39+11:00",
  },
  {
    name: "London, midwinter",
    zone: "Europe/London",
    night: "2026-12-21T03:00:00+00:00",
    noon: "2026-12-21T12:00:00+00:00",
    dawn: "2026-12-21T07:23:28+00:00",
    dusk: "2026-12-21T16:33:39+00:00",
  },
  {
    name: "London, the day summer time starts (29 Mar)",
    zone: "Europe/London",
    night: "2026-03-29T03:30:00+01:00",
    noon: "2026-03-29T12:00:00+01:00",
    dawn: "2026-03-29T06:08:30+01:00",
    dusk: "2026-03-29T20:01:59+01:00",
  },
  {
    name: "London, brand guide example",
    zone: "Europe/London",
    night: "2026-10-22T03:00:00+01:00",
    noon: "2026-10-22T12:00:00+01:00",
    dawn: "2026-10-22T07:02:34+01:00",
    dusk: "2026-10-22T18:27:21+01:00",
  },
  {
    name: "New York, the day daylight saving starts (8 Mar)",
    zone: "America/New_York",
    night: "2026-03-08T04:00:00-04:00",
    noon: "2026-03-08T12:00:00-04:00",
    dawn: "2026-03-08T06:51:11-04:00",
    dusk: "2026-03-08T19:22:16-04:00",
  },
  {
    name: "New York, the day daylight saving ends (1 Nov)",
    zone: "America/New_York",
    night: "2026-11-01T03:00:00-05:00",
    noon: "2026-11-01T12:00:00-05:00",
    dawn: "2026-11-01T05:58:17-05:00",
    dusk: "2026-11-01T17:20:54-05:00",
  },
  {
    name: "New York, brand guide example",
    zone: "America/New_York",
    night: "2026-10-22T03:00:00-04:00",
    noon: "2026-10-22T12:00:00-04:00",
    dawn: "2026-10-22T06:47:23-04:00",
    dusk: "2026-10-22T18:33:32-04:00",
  },
  {
    name: "Singapore, January",
    zone: "Asia/Singapore",
    night: "2026-01-15T03:00:00+08:00",
    noon: "2026-01-15T12:00:00+08:00",
    dawn: "2026-01-15T06:50:09+08:00",
    dusk: "2026-01-15T19:37:39+08:00",
  },
  {
    name: "Singapore, July (near the equator the times barely move)",
    zone: "Asia/Singapore",
    night: "2026-07-15T03:00:00+08:00",
    noon: "2026-07-15T12:00:00+08:00",
    dawn: "2026-07-15T06:42:44+08:00",
    dusk: "2026-07-15T19:38:26+08:00",
  },
];

describe("phaseAt follows civil dawn and dusk (±10 minutes of published tables)", () => {
  it.each(REFERENCE)("$name", ({ zone, night, noon, dawn, dusk }) => {
    const beforeDawn = phaseAt(at(night), zone);
    expect(beforeDawn.phase).toBe("dusk");
    expectNear(beforeDawn.nextChange, dawn);

    const midday = phaseAt(at(noon), zone);
    expect(midday.phase).toBe("day");
    expectNear(midday.nextChange, dusk);

    const evening = phaseAt(new Date(at(dusk).getTime() + 20 * 60_000), zone);
    expect(evening.phase).toBe("dusk");
    expect(evening.nextChange.getTime()).toBeGreaterThan(at(dusk).getTime() + 6 * 3_600_000);
  });

  it("flips exactly at the boundary it reported", () => {
    const { nextChange } = phaseAt(at("2026-10-22T12:00:00+11:00"), "Australia/Melbourne");
    expect(phaseAt(new Date(nextChange.getTime() - 1), "Australia/Melbourne").phase).toBe("day");
    expect(phaseAt(nextChange, "Australia/Melbourne").phase).toBe("dusk");
  });
});

describe("polar skies", () => {
  it("Reykjavik in June never gets dark enough for dusk: day all night", () => {
    // sunrise-sunset.org reports no civil twilight for 64.15 N on 21 Jun 2026.
    const midnight = phaseAt(at("2026-06-21T00:30:00+00:00"), "Atlantic/Reykjavik");
    expect(midnight.phase).toBe("day");
    // The first civil dusk after the white nights is in early August.
    expect(midnight.nextChange.getTime()).toBeGreaterThan(at("2026-07-20T00:00:00Z").getTime());
  });

  it("Tromsø in December: a short civil day around noon", () => {
    // sunrise-sunset.org, 69.6496 N 18.956 E, 21 Dec 2026: civil twilight 09:31:13 – 13:53:12 (+01:00).
    const tromso = { latitude: 69.6496, longitude: 18.956 };
    const morning = phaseAtLocation(at("2026-12-21T08:00:00+01:00"), tromso);
    expect(morning.phase).toBe("dusk");
    expectNear(morning.nextChange, "2026-12-21T09:31:13+01:00");
    const noon = phaseAtLocation(at("2026-12-21T12:00:00+01:00"), tromso);
    expect(noon.phase).toBe("day");
    expectNear(noon.nextChange, "2026-12-21T13:53:12+01:00");
  });

  it("Longyearbyen polar night stays on dusk until the sky returns in February", () => {
    // sunrise-sunset.org at zone.tab's 78 N 16 E: no civil twilight on 21 Dec 2026 or 28 Jan
    // 2027; the first one begins 29 Jan 2027 10:42:43 UTC. A grazing first crossing is the least
    // precise moment of the year, so this allows a day either side.
    const night = phaseAt(at("2026-12-21T12:00:00+01:00"), "Arctic/Longyearbyen");
    expect(night.phase).toBe("dusk");
    const returns = night.nextChange.getTime();
    expect(Math.abs(returns - at("2027-01-29T10:42:43Z").getTime())).toBeLessThan(86_400_000);
  });

  it("Longyearbyen midnight sun stays on day", () => {
    const summer = phaseAt(at("2026-06-21T00:00:00+02:00"), "Arctic/Longyearbyen");
    expect(summer.phase).toBe("day");
    expect(summer.nextChange.getTime()).toBeGreaterThan(at("2026-08-01T00:00:00Z").getTime());
  });
});

describe("civilTwilight", () => {
  it("returns null for a day with no crossing", () => {
    const { dawn, dusk } = civilTwilight(new Date(Date.UTC(2026, 11, 21)), {
      latitude: 78.22,
      longitude: 15.63,
    });
    expect(dawn).toBeNull();
    expect(dusk).toBeNull();
  });
});

describe("time zones without a city", () => {
  it.each([
    ["UTC", "2026-10-22T06:00:00Z", "dusk", "2026-10-22T06:30:00Z"],
    ["UTC", "2026-10-22T06:30:00Z", "day", "2026-10-22T19:00:00Z"],
    ["UTC", "2026-10-22T19:00:00Z", "dusk", "2026-10-23T06:30:00Z"],
    ["Etc/GMT-10", "2026-10-22T12:00:00+10:00", "day", "2026-10-22T19:00:00+10:00"],
    ["Not/A_Zone", "2026-10-22T23:00:00Z", "dusk", "2026-10-23T06:30:00Z"],
  ] as const)("%s at %s is %s until %s (06:30 / 19:00 local)", (zone, now, phase, next) => {
    const result = phaseAt(at(now), zone);
    expect(result.phase).toBe(phase);
    expect(result.nextChange.toISOString()).toBe(at(next).toISOString());
  });
});

describe("zone lookup", () => {
  it("finds zone.tab cities, old names and engine-canonical names", () => {
    expect(coordinatesForTimeZone("Australia/Melbourne")).toEqual({
      latitude: -37.82,
      longitude: 144.97,
    });
    expect(coordinatesForTimeZone("Australia/Victoria")).toEqual(
      coordinatesForTimeZone("Australia/Melbourne"),
    );
    expect(coordinatesForTimeZone("Asia/Calcutta")).toEqual(coordinatesForTimeZone("Asia/Kolkata"));
    expect(coordinatesForTimeZone("US/Eastern")).toEqual(
      coordinatesForTimeZone("America/New_York"),
    );
    // Its own city, even though tzdata links it to Europe/Berlin.
    expect(coordinatesForTimeZone("Europe/Oslo")?.latitude).toBeCloseTo(59.92);
    expect(coordinatesForTimeZone("UTC")).toBeNull();
  });
});

describe("wall-clock helpers across DST", () => {
  it("zonedTime lands on the right instant either side of a change", () => {
    expect(zonedTime(2026, 4, 5, 6, 30, "Australia/Melbourne").toISOString()).toBe(
      "2026-04-04T20:30:00.000Z",
    );
    expect(zonedTime(2026, 4, 4, 6, 30, "Australia/Melbourne").toISOString()).toBe(
      "2026-04-03T19:30:00.000Z",
    );
    expect(zonedTime(2026, 3, 8, 19, 0, "America/New_York").toISOString()).toBe(
      "2026-03-08T23:00:00.000Z",
    );
    expect(wallClock(at("2026-10-04T16:30:00Z"), "Australia/Melbourne")).toMatchObject({
      day: 5,
      hour: 3,
      minute: 30,
    });
  });
});
