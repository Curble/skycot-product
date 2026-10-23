// Who is using SKYCOT on a signed-in device, as the engine sees it ("who is who", Phase 1).
//
// A device linked from Settings › Family signs in through T3's own one-time pairing link, made
// with the subject `skycot-family-device:<deviceId>` (packages/skycot-rules/people.ts). That
// subject stays with the session for its whole life and no client can change it, so the engine
// only has to read the session's subject and look the device up in the Family profile:
//
// - no device subject: the family's Mac (or an older pairing), "shared", today's behaviour;
// - a child's device: always that child;
// - a grown-up's device: the approver;
// - a device subject whose record is gone (removed, or the profile turned off): "removed", and
//   the engine refuses it everything (its sessions are also revoked when it is removed).
//
// Callers that hold the session (the WebSocket gate, the HTTP routes) `remember` its subject
// first; anything that only has a session id (the Family limits) is answered from that, and a
// session the engine has not met yet is looked up in T3's session list. A lookup that fails says
// "removed" for that call: a broken lookup must not hand a child's device the Mac's freedom.

import type { AuthSessionId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { deviceIdFromSubject, type FamilyIdentity } from "@t3tools/skycot-rules/people";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as SkycotFamily from "../SkycotFamily.ts";

export type { FamilyIdentity };

export class SkycotFamilyIdentity extends Context.Service<
  SkycotFamilyIdentity,
  {
    /** Notes a session's subject (from the request that carries it), then says who it is. */
    readonly identifySession: (session: {
      readonly sessionId: string;
      readonly subject: string;
    }) => Effect.Effect<FamilyIdentity>;
    /** Who a session is, by id alone. */
    readonly identify: (sessionId: string) => Effect.Effect<FamilyIdentity>;
  }
>()("t3/skycot/family-devices/SkycotFamilyIdentity") {}

/** Pure: who a subject is, given the profile. */
export function identityFor(
  subject: string | null,
  status: Pick<SkycotFamily.FamilyStatus, "enabled" | "devices" | "children" | "grownUps">,
): FamilyIdentity {
  const deviceId = deviceIdFromSubject(subject);
  if (deviceId === null) return { kind: "shared" };
  if (!status.enabled) return { kind: "removed" };
  const device = status.devices.find((candidate) => candidate.id === deviceId);
  if (device === undefined) return { kind: "removed" };
  if (device.kind === "child") {
    return status.children.some((child) => child.id === device.personId)
      ? { kind: "child", deviceId, childId: device.personId, deviceName: device.name }
      : { kind: "removed" };
  }
  return status.grownUps.some((person) => person.id === device.personId)
    ? { kind: "grown-up", deviceId, personId: device.personId, deviceName: device.name }
    : { kind: "removed" };
}

const make = Effect.gen(function* () {
  const family = yield* SkycotFamily.SkycotFamily;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  // A session's subject never changes, so what was seen once stays true.
  const subjects = yield* Ref.make(new Map<string, string>());

  const judge = (subject: string | null) =>
    family.status.pipe(
      Effect.map((status) => identityFor(subject, status)),
      // An unreadable profile is "off": a device subject is then refused, the Mac is the Mac.
      Effect.orElseSucceed(() =>
        identityFor(subject, { enabled: false, devices: [], children: [], grownUps: [] }),
      ),
    );

  const identifySession: SkycotFamilyIdentity["Service"]["identifySession"] = (session) =>
    Ref.update(subjects, (known) =>
      known.get(session.sessionId) === session.subject
        ? known
        : new Map(known).set(session.sessionId, session.subject),
    ).pipe(Effect.andThen(judge(session.subject)));

  const identify: SkycotFamilyIdentity["Service"]["identify"] = Effect.fn(
    "SkycotFamilyIdentity.identify",
  )(function* (sessionId) {
    const known = (yield* Ref.get(subjects)).get(sessionId);
    if (known !== undefined) return yield* judge(known);
    const listed = yield* auth.listSessions().pipe(Effect.option);
    if (listed._tag === "None") {
      yield* Effect.logWarning("skycot-family.identity-lookup-failed");
      return { kind: "removed" } satisfies FamilyIdentity;
    }
    const match = listed.value.find(
      (session) => session.sessionId === (sessionId as AuthSessionId),
    );
    if (match === undefined) return { kind: "removed" } satisfies FamilyIdentity;
    yield* Ref.update(subjects, (map) => new Map(map).set(sessionId, match.subject));
    return yield* judge(match.subject);
  });

  return SkycotFamilyIdentity.of({ identifySession, identify });
});

export const layer = Layer.effect(SkycotFamilyIdentity, make);

/**
 * For tests: sessions with fixed subjects, judged against the real profile. Unknown sessions are
 * the Mac's.
 */
export const layerSubjects = (subjects: Readonly<Record<string, string>>) =>
  Layer.effect(
    SkycotFamilyIdentity,
    Effect.gen(function* () {
      const family = yield* SkycotFamily.SkycotFamily;
      const judge = (subject: string | null) =>
        family.status.pipe(
          Effect.map((status) => identityFor(subject, status)),
          Effect.orElseSucceed((): FamilyIdentity => ({ kind: "shared" })),
        );
      return SkycotFamilyIdentity.of({
        identifySession: (session) => judge(session.subject),
        identify: (sessionId) => judge(subjects[sessionId] ?? null),
      });
    }),
  );

/** Who a session is when no identity service is around (older tests, tools): the Mac. */
export const identifyOptional = (sessionId: string) =>
  Effect.serviceOption(SkycotFamilyIdentity).pipe(
    Effect.flatMap((service) =>
      service._tag === "Some"
        ? service.value.identify(sessionId)
        : Effect.succeed<FamilyIdentity>({ kind: "shared" }),
    ),
  );
