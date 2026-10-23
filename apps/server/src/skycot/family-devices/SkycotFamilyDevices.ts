// Devices linked to a person, engine side ("who is who", Phase 1): linking one with T3's own
// one-time pairing link, listing them with when each was last seen, removing one (its sign-in and
// passkey end at once), passkeys for grown-ups' devices, and the approver's work: the requests
// waiting for a grown-up, answering one (accept or decline, once), more time and "lock everything".
//
// Nothing here invents its own sign-in. A link is T3's pairing link with:
// - the subject `skycot-family-device:<id>`, which the device's session carries for its whole
//   life and no client can change (SkycotFamilyIdentity reads it);
// - the scopes for its kind, fixed when the link is made (a token exchange can only narrow them):
//   a child's device gets what the plain client needs and none of the developer tools; a
//   grown-up's device gets T3's read scope only. Its "say yes or no" is SKYCOT's own permission,
//   checked here on every answer.

// Hashing and random challenges have no Effect counterpart; these are pure calls.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";

import {
  AuthDiagnosticsReadScope,
  AuthFilesystemReadScope,
  AuthFilesystemWriteScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthPreviewOperateScope,
  AuthSettingsWriteScope,
  AuthSourceControlWriteScope,
  CommandId,
  type AuthEnvironmentScope,
  type RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import {
  APPROVAL_LAPSE_MS,
  deviceSubject,
  LINK_TTL_MS,
  PASSKEY_CHALLENGE_TTL_MS,
  type ApproverDecision,
  type DeviceKind,
  type FamilyIdentity,
} from "@t3tools/skycot-rules/people";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../../config.ts";
import { resolveBoundEndpoints } from "../../environment/DirectEndpoints.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as SkycotFamilyLimits from "../family-limits/SkycotFamilyLimits.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
import * as SkycotFamilyGate from "../SkycotFamilyGate.ts";
import {
  makeChallenge,
  PasskeyError,
  relyingPartyFor,
  SUPPORTED_ALGORITHMS,
  toBase64Url,
  verifyAssertion,
  verifyRegistration,
} from "./passkeys.ts";

/**
 * What a child's own device may do in T3's terms: everything the plain client needs, and none of
 * the developer tools (terminals, updates, AI sign-ins, pairing more devices, the relay). The
 * Family gate still holds every grown-up step on top of this.
 */
export const CHILD_DEVICE_SCOPES: ReadonlyArray<AuthEnvironmentScope> = [
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  AuthPreviewOperateScope,
  AuthDiagnosticsReadScope,
  AuthSourceControlWriteScope,
  AuthFilesystemReadScope,
  AuthFilesystemWriteScope,
];

/** A grown-up's device: T3's read scope only. Answers go through SKYCOT's approver routes. */
export const GROWN_UP_DEVICE_SCOPES: ReadonlyArray<AuthEnvironmentScope> = [
  AuthOrchestrationReadScope,
];

export const scopesFor = (kind: DeviceKind) =>
  kind === "child" ? CHILD_DEVICE_SCOPES : GROWN_UP_DEVICE_SCOPES;

export type DevicesFailureReason =
  | "not-allowed"
  | "invalid-request"
  | "gone"
  | "lapsed"
  | "changed"
  | "proof-needed"
  | "passkey"
  | "insecure"
  | "failed";

export class DevicesError extends Error {
  readonly _tag = "SkycotFamilyDevicesError";
  readonly reason: DevicesFailureReason;
  constructor(reason: DevicesFailureReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

const fail = (reason: DevicesFailureReason, message: string) =>
  Effect.fail(new DevicesError(reason, message));

export interface DeviceRow {
  readonly id: string;
  readonly kind: DeviceKind;
  readonly personId: string;
  readonly name: string;
  readonly createdAt: string;
  /** Waiting for its link to be opened, linked, or the link ran out unused. */
  readonly status: "waiting" | "linked";
  readonly linkExpiresAt: number | null;
  readonly lastSeenAt: string | null;
  readonly connected: boolean;
  readonly passkey: boolean;
}

export interface LinkResult {
  readonly deviceId: string;
  /** The one-time code (12 letters and digits), to type or to scan. */
  readonly code: string;
  readonly expiresAt: number;
}

export interface PendingApproval {
  readonly threadId: string;
  readonly requestId: string;
  readonly childId: string | null;
  readonly threadTitle: string;
  readonly projectTitle: string | null;
  readonly createdAt: number;
  /** Older than ten minutes: it waits on the Mac now (the approval contract, rule 4). */
  readonly lapsed: boolean;
  readonly needsGrownUp: boolean;
  readonly why: string | null;
  readonly what: string;
  readonly kind: string;
  /** What the phone shows, hashed: a yes names it, so a changed card can't be approved unseen. */
  readonly fingerprint: string;
}

/** How a grown-up's device proves it is the grown-up for a yes. */
export type Proof =
  | { readonly type: "code"; readonly code: string }
  | {
      readonly type: "passkey";
      readonly credentialId: string;
      readonly response: unknown;
      /** The challenge the engine gave for this action (base64url). */
      readonly challenge: string;
    };

type GrownUpIdentity = Extract<FamilyIdentity, { kind: "grown-up" }>;

interface ChallengeEntry {
  readonly deviceId: string;
  readonly action: string;
  readonly origin: string;
  readonly rpId: string;
  readonly expiresAt: number;
}

export function fingerprintFor(input: {
  readonly threadId: string;
  readonly requestId: string;
  readonly what: string;
  readonly why: string | null;
}): string {
  return NodeCrypto.createHash("sha256")
    .update([input.threadId, input.requestId, input.what, input.why ?? ""].join("\n"))
    .digest("hex")
    .slice(0, 24);
}

const approveAction = (threadId: string, requestId: string, fingerprint: string) =>
  `approve:${threadId}:${requestId}:${fingerprint}`;
const moreTimeAction = (childId: string, kind: string) => `more-time:${childId}:${kind}`;

const MORE_TIME: Readonly<Record<string, SkycotFamilyLimits.MoreTime>> = {
  extra15: { type: "extra", minutes: 15 },
  extra30: { type: "extra", minutes: 30 },
  endBedtime: { type: "endBedtime" },
};

export class SkycotFamilyDevices extends Context.Service<
  SkycotFamilyDevices,
  {
    readonly createLink: (input: {
      readonly kind: DeviceKind;
      readonly personId: string;
      readonly name: string | null;
    }) => Effect.Effect<LinkResult, DevicesError | SkycotFamily.FamilyError>;
    readonly list: Effect.Effect<ReadonlyArray<DeviceRow>>;
    /** The addresses another device could open a link at, best first; this Mac's own last. */
    readonly linkAddresses: (
      requestOrigin: string | null,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly base: string; readonly label: string; readonly reachable: boolean }>
    >;
    readonly remove: (deviceId: string) => Effect.Effect<void, SkycotFamily.FamilyError>;
    /** Ends the sign-ins of devices the profile no longer has (a person removed, a new code). */
    readonly endVanished: (before: SkycotFamily.FamilyStatus) => Effect.Effect<void>;
    /** Every linked device's sign-in ends (the profile is turned off). */
    readonly endAll: Effect.Effect<void>;
    readonly passkeyOptions: (input: {
      readonly who: GrownUpIdentity;
      readonly origin: string;
      readonly code: string;
    }) => Effect.Effect<unknown, DevicesError | SkycotFamily.FamilyError>;
    readonly passkeyRegister: (input: {
      readonly who: GrownUpIdentity;
      readonly origin: string;
      readonly challenge: string;
      readonly response: unknown;
    }) => Effect.Effect<void, DevicesError | SkycotFamily.FamilyError>;
    readonly passkeyForget: (who: GrownUpIdentity) => Effect.Effect<void, SkycotFamily.FamilyError>;
    readonly approvals: Effect.Effect<ReadonlyArray<PendingApproval>>;
    /** A passkey challenge for one action of this grown-up's device. */
    readonly challenge: (input: {
      readonly who: GrownUpIdentity;
      readonly origin: string;
      readonly action:
        | {
            readonly type: "approve";
            readonly threadId: string;
            readonly requestId: string;
            readonly fingerprint: string;
          }
        | { readonly type: "more-time"; readonly childId: string; readonly kind: string };
    }) => Effect.Effect<unknown, DevicesError>;
    readonly answer: (input: {
      readonly who: GrownUpIdentity;
      readonly sessionId: string;
      readonly origin: string;
      readonly threadId: string;
      readonly requestId: string;
      readonly decision: ApproverDecision;
      readonly fingerprint: string;
      readonly proof: Proof | null;
    }) => Effect.Effect<void, DevicesError | SkycotFamily.FamilyError>;
    readonly moreTime: (input: {
      readonly who: GrownUpIdentity;
      readonly sessionId: string;
      readonly origin: string;
      readonly childId: string;
      readonly kind: string;
      readonly proof: Proof | null;
    }) => Effect.Effect<void, DevicesError | SkycotFamily.FamilyError>;
  }
>()("t3/skycot/family-devices/SkycotFamilyDevices") {}

const make = Effect.gen(function* () {
  const family = yield* SkycotFamily.SkycotFamily;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const gate = yield* SkycotFamilyGate.SkycotFamilyGate;
  const limits = yield* SkycotFamilyLimits.SkycotFamilyLimits;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const engine = yield* Orchestrator.OrchestratorV2;
  const config = yield* ServerConfig.ServerConfig;
  // Challenges live in memory only: an engine restart forgets them (ask again), nothing to leak.
  const challenges = yield* Ref.make(new Map<string, ChallengeEntry>());

  const now = Clock.currentTimeMillis;

  const sessionsOf = (deviceId: string) =>
    auth.listSessions().pipe(
      Effect.map((sessions) =>
        sessions.filter((session) => session.subject === deviceSubject(deviceId)),
      ),
      Effect.orElseSucceed(() => []),
    );

  /** Ends a device's sign-ins and its unused link. Revoking closes its open socket at once. */
  const endDevice = Effect.fn("SkycotFamilyDevices.endDevice")(function* (
    deviceId: string,
    linkId: string | null,
  ) {
    for (const session of yield* sessionsOf(deviceId)) {
      yield* auth
        .revokeSession(session.sessionId)
        .pipe(Effect.ignoreCause({ log: true, message: "Could not end a device's sign-in." }));
    }
    if (linkId !== null) {
      yield* auth.revokePairingLink(linkId).pipe(Effect.ignore);
    }
  });

  const createLink: SkycotFamilyDevices["Service"]["createLink"] = Effect.fn(
    "SkycotFamilyDevices.createLink",
  )(function* (input) {
    const deviceId = SkycotFamily.newDeviceId();
    const issued = yield* auth
      .createPairingLink({
        ttl: Duration.millis(LINK_TTL_MS),
        scopes: scopesFor(input.kind),
        subject: deviceSubject(deviceId),
        ...(input.name ? { label: input.name.slice(0, 40) } : {}),
      })
      .pipe(
        Effect.mapError(
          () => new DevicesError("failed", "SKYCOT couldn't make a link. Try again."),
        ),
      );
    const expiresAt = issued.expiresAt.epochMilliseconds;
    yield* family
      .addDevice({
        id: deviceId,
        kind: input.kind,
        personId: input.personId,
        name: input.name,
        linkId: issued.id,
        linkExpiresAt: expiresAt,
      })
      .pipe(Effect.tapError(() => auth.revokePairingLink(issued.id).pipe(Effect.ignore)));
    yield* Effect.logInfo("skycot-family.device-link-made", { deviceId, kind: input.kind });
    return { deviceId, code: issued.credential, expiresAt } satisfies LinkResult;
  });

  const list: SkycotFamilyDevices["Service"]["list"] = Effect.gen(function* () {
    const status = yield* family.status.pipe(Effect.orElseSucceed(() => null));
    if (status === null || !status.enabled) return [];
    const sessions = yield* auth.listSessions().pipe(Effect.orElseSucceed(() => []));
    const at = yield* now;
    const rows: Array<DeviceRow> = [];
    for (const view of status.devices) {
      const mine = sessions.filter((session) => session.subject === deviceSubject(view.id));
      const record = yield* family.device(view.id);
      if (record === null) continue;
      if (mine.length === 0 && record.linkExpiresAt <= at) {
        // A link that ran out unused: nothing was linked, so the waiting row goes.
        yield* family.removeDevice({ deviceId: view.id }).pipe(Effect.ignore);
        yield* endDevice(view.id, record.linkId);
        continue;
      }
      const seen = mine
        .map((session) => session.lastConnectedAt ?? session.issuedAt)
        .toSorted((a, b) => b.epochMilliseconds - a.epochMilliseconds)[0];
      rows.push({
        id: view.id,
        kind: view.kind,
        personId: view.personId,
        name: view.name,
        createdAt: view.createdAt,
        status: mine.length > 0 ? "linked" : "waiting",
        linkExpiresAt: mine.length > 0 ? null : record.linkExpiresAt,
        lastSeenAt: seen === undefined ? null : DateTime.formatIso(seen),
        connected: mine.some((session) => session.connected),
        passkey: view.passkeys > 0,
      });
    }
    return rows;
  }).pipe(Effect.withSpan("SkycotFamilyDevices.list"));

  const remove: SkycotFamilyDevices["Service"]["remove"] = Effect.fn("SkycotFamilyDevices.remove")(
    function* (deviceId) {
      const record = yield* family.device(deviceId);
      // The record goes first: from this instant the engine refuses the device everything,
      // even on a socket that is still closing.
      yield* family.removeDevice({ deviceId });
      yield* endDevice(deviceId, record?.linkId ?? null);
      yield* Ref.update(challenges, (book) => {
        const next = new Map(book);
        for (const [key, entry] of book) if (entry.deviceId === deviceId) next.delete(key);
        return next;
      });
      yield* Effect.logInfo("skycot-family.device-removed", { deviceId });
    },
  );

  const endVanished: SkycotFamilyDevices["Service"]["endVanished"] = Effect.fn(
    "SkycotFamilyDevices.endVanished",
  )(function* (before) {
    const after = yield* family.status.pipe(Effect.orElseSucceed(() => null));
    const kept = new Set(after?.enabled ? after.devices.map((device) => device.id) : []);
    for (const device of before.devices) {
      if (!kept.has(device.id)) yield* endDevice(device.id, null);
    }
  });

  const endAll: SkycotFamilyDevices["Service"]["endAll"] = Effect.gen(function* () {
    const sessions = yield* auth.listSessions().pipe(Effect.orElseSucceed(() => []));
    for (const session of sessions) {
      if (session.subject.startsWith("skycot-family-device:")) {
        yield* auth.revokeSession(session.sessionId).pipe(Effect.ignore);
      }
    }
  }).pipe(Effect.withSpan("SkycotFamilyDevices.endAll"));

  const needRelyingParty = (origin: string) => {
    const rpId = relyingPartyFor(origin);
    return rpId === null
      ? fail(
          "insecure",
          "Face ID needs a secure connection to the Mac. Use the parent code on this device for now.",
        )
      : Effect.succeed(rpId);
  };

  const issueChallenge = Effect.fn("SkycotFamilyDevices.issueChallenge")(function* (
    who: GrownUpIdentity,
    origin: string,
    action: string,
  ) {
    const rpId = yield* needRelyingParty(origin);
    const challenge = makeChallenge(action);
    const key = toBase64Url(challenge);
    const at = yield* now;
    yield* Ref.update(challenges, (book) => {
      const next = new Map([...book].filter(([, entry]) => entry.expiresAt > at));
      next.set(key, {
        deviceId: who.deviceId,
        action,
        origin,
        rpId,
        expiresAt: at + PASSKEY_CHALLENGE_TTL_MS,
      });
      return next;
    });
    return { challenge: key, rpId };
  });

  /** Takes a challenge out of the book (one use), if it was made for this device and action. */
  const spendChallenge = Effect.fn("SkycotFamilyDevices.spendChallenge")(function* (
    who: GrownUpIdentity,
    key: string,
    action: string,
    origin: string,
  ) {
    const at = yield* now;
    const entry = yield* Ref.modify(challenges, (book) => {
      const found = book.get(key);
      const next = new Map(book);
      next.delete(key);
      return [found, next] as const;
    });
    if (
      entry === undefined ||
      entry.expiresAt <= at ||
      entry.deviceId !== who.deviceId ||
      entry.action !== action ||
      entry.origin !== origin
    ) {
      return yield* fail("passkey", "That Face ID check ran out. Try again.");
    }
    return entry;
  });

  const passkeyOptions: SkycotFamilyDevices["Service"]["passkeyOptions"] = Effect.fn(
    "SkycotFamilyDevices.passkeyOptions",
  )(function* (input) {
    yield* needRelyingParty(input.origin);
    // The parent code once, so a passkey is only ever added by a grown-up.
    yield* family.checkCode({ code: input.code });
    const { challenge, rpId } = yield* issueChallenge(input.who, input.origin, "register");
    const status = yield* family.status;
    const person = status.grownUps.find((candidate) => candidate.id === input.who.personId);
    return {
      challenge,
      rp: { id: rpId, name: "SKYCOT" },
      user: {
        id: toBase64Url(Buffer.from(input.who.deviceId)),
        name: person?.name ?? "Grown-up",
        displayName: `${person?.name ?? "Grown-up"} (${input.who.deviceName})`,
      },
      pubKeyCredParams: SUPPORTED_ALGORITHMS.map((alg) => ({ type: "public-key", alg })),
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      attestation: "none",
      timeout: PASSKEY_CHALLENGE_TTL_MS,
    };
  });

  const passkeyRegister: SkycotFamilyDevices["Service"]["passkeyRegister"] = Effect.fn(
    "SkycotFamilyDevices.passkeyRegister",
  )(function* (input) {
    const entry = yield* spendChallenge(input.who, input.challenge, "register", input.origin);
    const at = yield* now;
    const passkey = yield* Effect.try({
      try: () =>
        verifyRegistration({
          response: input.response,
          expected: {
            challenge: new Uint8Array(Buffer.from(input.challenge, "base64url")),
            origin: entry.origin,
            rpId: entry.rpId,
          },
          now: DateTime.formatIso(DateTime.makeUnsafe(at)),
        }),
      catch: (error) =>
        new DevicesError(
          "passkey",
          error instanceof PasskeyError
            ? "Face ID didn't finish setting up. Try again."
            : "Face ID didn't finish setting up. Try again.",
        ),
    });
    yield* family.addPasskey({ deviceId: input.who.deviceId, passkey });
    yield* Effect.logInfo("skycot-family.passkey-added", { deviceId: input.who.deviceId });
  });

  const passkeyForget: SkycotFamilyDevices["Service"]["passkeyForget"] = (who) =>
    family.removePasskeys({ deviceId: who.deviceId }).pipe(Effect.asVoid);

  const approvals: SkycotFamilyDevices["Service"]["approvals"] = Effect.gen(function* () {
    if (!(yield* family.isEnabled)) return [];
    const shell = yield* projections
      .getShellSnapshot({ location: "active" })
      .pipe(Effect.orElseSucceed(() => null));
    if (shell === null) return [];
    const projectTitles = new Map(
      (yield* projects.list().pipe(Effect.orElseSucceed(() => []))).map(
        (project) => [String(project.projectId), project.title] as const,
      ),
    );
    const owners = (yield* limits.today).threads;
    const at = yield* now;
    const found: Array<PendingApproval> = [];
    for (const thread of shell.threads) {
      const pending = thread.pendingRuntimeRequest;
      if (pending === null) continue;
      const described = yield* gate.describeRequest({
        threadId: thread.id,
        requestId: pending.id,
      });
      if (described === null) continue;
      const createdAt = pending.createdAt.epochMilliseconds;
      found.push({
        threadId: thread.id,
        requestId: pending.id,
        childId: owners[thread.id] ?? null,
        threadTitle: thread.title,
        projectTitle: projectTitles.get(String(thread.projectId)) ?? null,
        createdAt,
        lapsed: at - createdAt > APPROVAL_LAPSE_MS,
        needsGrownUp: described.needsGrownUp,
        why: described.why,
        what: described.what,
        kind: described.kind,
        fingerprint: fingerprintFor({
          threadId: thread.id,
          requestId: pending.id,
          what: described.what,
          why: described.why,
        }),
      });
    }
    return found.toSorted((a, b) => b.createdAt - a.createdAt);
  }).pipe(Effect.withSpan("SkycotFamilyDevices.approvals"));

  const challenge: SkycotFamilyDevices["Service"]["challenge"] = Effect.fn(
    "SkycotFamilyDevices.challenge",
  )(function* (input) {
    const record = yield* family.device(input.who.deviceId);
    if (record === null || record.passkeys.length === 0) {
      return yield* fail("passkey", "Face ID isn't set up on this device yet.");
    }
    const action =
      input.action.type === "approve"
        ? approveAction(input.action.threadId, input.action.requestId, input.action.fingerprint)
        : moreTimeAction(input.action.childId, input.action.kind);
    const issued = yield* issueChallenge(input.who, input.origin, action);
    return {
      challenge: issued.challenge,
      rpId: issued.rpId,
      allowCredentials: record.passkeys.map((passkey) => ({ type: "public-key", id: passkey.id })),
      userVerification: "required",
      timeout: PASSKEY_CHALLENGE_TTL_MS,
    };
  });

  /** The grown-up's proof for one action: the parent code (counted like every try) or a passkey. */
  const prove = Effect.fn("SkycotFamilyDevices.prove")(function* (
    who: GrownUpIdentity,
    origin: string,
    action: string,
    proof: Proof | null,
  ) {
    if (proof === null) {
      return yield* fail("proof-needed", "Use Face ID or the parent code to say yes.");
    }
    if (proof.type === "code") {
      yield* family.checkCode({ code: proof.code });
      return "code" as const;
    }
    const entry = yield* spendChallenge(who, proof.challenge, action, origin);
    const record = yield* family.device(who.deviceId);
    if (record === null) return yield* fail("not-allowed", SkycotFamilyGate.REMOVED_DEVICE_MESSAGE);
    const used = yield* Effect.try({
      try: () =>
        verifyAssertion({
          response: proof.response,
          credentialId: proof.credentialId,
          passkeys: record.passkeys,
          expected: {
            challenge: new Uint8Array(Buffer.from(proof.challenge, "base64url")),
            origin: entry.origin,
            rpId: entry.rpId,
          },
        }),
      catch: () =>
        new DevicesError(
          "passkey",
          "Face ID didn't confirm that. Try again, or use the parent code.",
        ),
    });
    yield* family.usePasskey({ deviceId: who.deviceId, ...used });
    return "passkey" as const;
  });

  const answer: SkycotFamilyDevices["Service"]["answer"] = Effect.fn("SkycotFamilyDevices.answer")(
    function* (input) {
      const threadId = input.threadId as ThreadId;
      const requestId = input.requestId as RuntimeRequestId;
      const request = yield* projections
        .getRuntimeRequest(threadId, requestId)
        .pipe(Effect.orElseSucceed(() => undefined));
      if (
        request === undefined ||
        request.status !== "pending" ||
        request.responseCapability.type !== "live"
      ) {
        return yield* fail("gone", "That request was already answered, or it stopped.");
      }
      const at = yield* now;
      if (at - request.createdAt.epochMilliseconds > APPROVAL_LAPSE_MS) {
        return yield* fail("lapsed", "This one is waiting on the Mac now. Answer it there.");
      }
      const described = yield* gate.describeRequest({ threadId, requestId });
      if (described === null) return yield* fail("gone", "That request can't be read any more.");
      const fingerprint = fingerprintFor({
        threadId: input.threadId,
        requestId: input.requestId,
        what: described.what,
        why: described.why,
      });
      if (fingerprint !== input.fingerprint) {
        return yield* fail("changed", "That request changed. Have another look before you answer.");
      }
      // Saying no is free (the approval contract, rule 6); a yes needs Face ID or the code.
      const how =
        input.decision === "accept"
          ? yield* prove(
              input.who,
              input.origin,
              approveAction(input.threadId, input.requestId, fingerprint),
              input.proof,
            )
          : null;
      // One request, once: the engine resolves it, and a second answer finds it no longer pending.
      yield* engine
        .dispatch({
          type: "runtime-request.respond",
          commandId: CommandId.make(
            `server:skycot-approver:${input.threadId}:${input.requestId}:${input.who.deviceId}`,
          ),
          threadId,
          requestId,
          decision: input.decision,
        })
        .pipe(
          Effect.mapError(
            () => new DevicesError("gone", "That request was already answered, or it stopped."),
          ),
        );
      const owner = (yield* limits.today).threads[input.threadId];
      yield* limits.recordEvent({
        sessionId: input.sessionId,
        kind: input.decision === "accept" ? "approved" : "declined",
        threadId: input.threadId,
        requestId: input.requestId,
        ...(owner === undefined ? {} : { childId: owner }),
        by: {
          personId: input.who.personId,
          deviceId: input.who.deviceId,
          deviceName: input.who.deviceName,
        },
      });
      yield* Effect.logInfo("skycot-family.approver-answered", {
        deviceId: input.who.deviceId,
        decision: input.decision,
        how,
      });
    },
  );

  const moreTime: SkycotFamilyDevices["Service"]["moreTime"] = Effect.fn(
    "SkycotFamilyDevices.moreTime",
  )(function* (input) {
    const more = MORE_TIME[input.kind];
    if (more === undefined)
      return yield* fail("invalid-request", "That request was not understood.");
    yield* prove(input.who, input.origin, moreTimeAction(input.childId, input.kind), input.proof);
    yield* limits.grantMoreTime({ sessionId: input.sessionId, childId: input.childId, more });
  });

  const linkAddresses: SkycotFamilyDevices["Service"]["linkAddresses"] = (requestOrigin) =>
    Effect.sync(() => {
      const loopback = (base: string) => /\/\/(localhost|127\.|\[::1\])/.test(base);
      const bound = resolveBoundEndpoints({
        host: config.host,
        port: config.port,
        interfaces: NodeOS.networkInterfaces(),
      }).map((endpoint) => ({
        base: endpoint.httpBaseUrl.replace(/\/+$/, ""),
        label: endpoint.kind === "tailnet" ? "Tailscale" : "Home network",
        reachable: true,
      }));
      const own =
        requestOrigin === null
          ? []
          : [
              {
                base: requestOrigin,
                label: loopback(requestOrigin) ? "This Mac only" : "This address",
                reachable: !loopback(requestOrigin),
              },
            ];
      const seen = new Set<string>();
      return [...bound, ...own].filter((entry) => {
        if (seen.has(entry.base)) return false;
        seen.add(entry.base);
        return true;
      });
    });

  return SkycotFamilyDevices.of({
    linkAddresses,
    createLink,
    list,
    remove,
    endVanished,
    endAll,
    passkeyOptions,
    passkeyRegister,
    passkeyForget,
    approvals,
    challenge,
    answer,
    moreTime,
  });
});

export const layer = Layer.effect(SkycotFamilyDevices, make);
