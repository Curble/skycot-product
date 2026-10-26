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
// nondev-seam: skycot-page-internet-approver
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
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import {
  APPROVAL_LAPSE_MS,
  cleanName,
  DEVICE_NAME_MAX,
  deviceKeyRegisterAction,
  deviceKeySignedMessage,
  deviceSubject,
  LINK_TTL_MS,
  PASSKEY_CHALLENGE_TTL_MS,
  watchRegisterAction,
  watchSignedMessage,
  type ApproverDecision,
  type DeviceKeyBiometry,
  type DeviceKind,
  type FamilyIdentity,
  type WatchKeyProtection,
  type WatchPurpose,
} from "@t3tools/skycot-rules/people";
import type { ProjectApprovalCover } from "@t3tools/skycot-rules/family";

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
import { readWatchPublicKey, verifyWatchSignature, watchKeyId } from "./watchKeys.ts";

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
  | "watch"
  | "device-key"
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
  /** The Apple Watch that may say yes through this phone, by name. */
  readonly watch: string | null;
  /** Whether this grown-up's device says yes with its own Face ID key. */
  readonly faceId: boolean;
}

export interface LinkResult {
  readonly deviceId: string;
  /** The one-time code (12 letters and digits), to type or to scan. */
  readonly code: string;
  readonly expiresAt: number;
}

// nondev-seam: skycot-project-approval-answer
export interface PendingApproval {
  /** Older clients may omit this; absent means the existing runtime request. */
  readonly target?: "runtime-request" | "page-internet";
  readonly threadId: string;
  readonly requestId: string;
  readonly childId: string | null;
  readonly threadTitle: string;
  readonly projectTitle: string | null;
  readonly createdAt: number;
  /** Older than 30 minutes: it waits on the Mac now (the approval contract, rule 4). */
  readonly lapsed: boolean;
  /** Always true in `approvals` (kept on the wire for older phones, which filter on it). */
  readonly needsGrownUp: boolean;
  readonly why: string | null;
  readonly what: string;
  readonly kind: string;
  /** What the phone shows, hashed: a yes names it, so a changed card can't be approved unseen. */
  readonly fingerprint: string;
  /** The project-scoped answer has a separate fingerprint, bound to this exact cover set. */
  readonly projectFingerprint?: string;
  readonly projectCovers?: ReadonlyArray<ProjectApprovalCover>;
  readonly page?: string;
  readonly sites?: ReadonlyArray<string>;
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
    }
  | {
      /** The grown-up's Apple Watch, through their phone (Phase 4). */
      readonly type: "watch";
      readonly keyId: string;
      readonly challenge: string;
      /** ECDSA P-256 over `watchSignedMessage("approve", challenge, action)`, DER, base64url. */
      readonly signature: string;
    }
  | {
      /** The grown-up's device's own Face ID key (Secure Enclave, Face ID for each signature). */
      readonly type: "device-key";
      readonly keyId: string;
      readonly challenge: string;
      /** ECDSA P-256 over `deviceKeySignedMessage("approve", challenge, action)`, DER, base64url. */
      readonly signature: string;
    };

/** Where an answer was given, when it wasn't the phone itself. */
export interface AnswerVia {
  readonly kind: "watch";
  readonly name: string;
}

type GrownUpIdentity = Extract<FamilyIdentity, { kind: "grown-up" }>;

/** A challenge for a key the engine checks itself: the Watch's, or the device's own Face ID key. */
type SignedKind = "watch" | "device-key";

interface ChallengeEntry {
  /**
   * A passkey's (bound to the address it was asked on), or a Watch's or Face ID key's (any way
   * to the Mac). A challenge of one kind is never spent as another.
   */
  readonly kind: "passkey" | SignedKind;
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
  readonly scope?: "once" | "project";
  readonly covers?: ReadonlyArray<ProjectApprovalCover>;
}): string {
  const material = [input.threadId, input.requestId, input.what, input.why ?? ""];
  if (input.scope === "project") material.push("project", ...(input.covers ?? []).toSorted());
  return NodeCrypto.createHash("sha256").update(material.join("\n")).digest("hex").slice(0, 24);
}

const approveAction = (threadId: string, requestId: string, fingerprint: string) =>
  `approve:${threadId}:${requestId}:${fingerprint}`;
export const pageAskMaterial = (childId: string, page: string, sites: ReadonlyArray<string>) =>
  JSON.stringify({ target: "page-internet", page, sites: sites.toSorted(), childId });
const PAGE_ASK_WHY = "This page wants the internet.";
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
    /** Setting up "Say yes from my Apple Watch": the parent code once, then a challenge to sign. */
    readonly watchKeyOptions: (input: {
      readonly who: GrownUpIdentity;
      readonly code: string;
    }) => Effect.Effect<
      { readonly challenge: string; readonly action: string; readonly purpose: WatchPurpose },
      DevicesError | SkycotFamily.FamilyError
    >;
    readonly watchKeyRegister: (input: {
      readonly who: GrownUpIdentity;
      readonly challenge: string;
      readonly publicKey: string;
      readonly signature: string;
      readonly name: string | null;
      readonly protection: WatchKeyProtection;
    }) => Effect.Effect<{ readonly keyId: string }, DevicesError | SkycotFamily.FamilyError>;
    readonly watchKeyForget: (
      who: GrownUpIdentity,
    ) => Effect.Effect<void, SkycotFamily.FamilyError>;
    /** A challenge for one yes from this phone's Apple Watch. */
    readonly watchChallenge: (input: {
      readonly who: GrownUpIdentity;
      readonly threadId: string;
      readonly requestId: string;
      readonly fingerprint: string;
    }) => Effect.Effect<
      {
        readonly challenge: string;
        readonly action: string;
        readonly purpose: WatchPurpose;
        readonly keyId: string;
      },
      DevicesError
    >;
    /** Setting up "Use Face ID to say yes": the parent code once, then a challenge to sign. */
    readonly deviceKeyOptions: (input: {
      readonly who: GrownUpIdentity;
      readonly code: string;
    }) => Effect.Effect<
      { readonly challenge: string; readonly action: string; readonly purpose: "register" },
      DevicesError | SkycotFamily.FamilyError
    >;
    readonly deviceKeyRegister: (input: {
      readonly who: GrownUpIdentity;
      readonly challenge: string;
      readonly publicKey: string;
      readonly signature: string;
      readonly biometry: DeviceKeyBiometry;
    }) => Effect.Effect<{ readonly keyId: string }, DevicesError | SkycotFamily.FamilyError>;
    /** "Stop using Face ID": it only takes away, so no proof. */
    readonly deviceKeyForget: (
      who: GrownUpIdentity,
    ) => Effect.Effect<void, SkycotFamily.FamilyError>;
    /** A challenge for one yes with this device's Face ID key, for the card it shows. */
    readonly deviceKeyChallenge: (input: {
      readonly who: GrownUpIdentity;
      readonly threadId: string;
      readonly requestId: string;
      readonly fingerprint: string;
    }) => Effect.Effect<
      {
        readonly challenge: string;
        readonly action: string;
        readonly purpose: "approve";
        readonly keyId: string;
      },
      DevicesError
    >;
    /**
     * What a grown-up's device lists, counts, mirrors and is told about: only the requests that
     * need a grown-up. A child's own "Ask me first" steps are theirs to answer at the Mac.
     */
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
      /** Missing on older clients: the original one-request answer. */
      readonly scope?: "once" | "project";
      readonly proof: Proof | null;
      /**
       * A no said on the grown-up's Watch and carried by their phone (a no needs no proof, so
       * this is the phone's word for where it was said). A yes from the Watch is known by its
       * proof instead.
       */
      readonly via?: "watch" | null;
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
  const fs = yield* Effect.serviceOption(FileSystem.FileSystem);
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
        watch: view.watch,
        faceId: view.faceId,
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
        kind: "passkey",
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

  /**
   * A Watch's or a Face ID key's challenge: as a passkey's (this device, this action, two
   * minutes, once), but not bound to a web address, since it is signed in an app, not on a web
   * page. The phone may reach the Mac one way for the challenge and another for the answer
   * (relay, then home Wi-Fi).
   */
  const issueSignedChallenge = Effect.fn("SkycotFamilyDevices.issueSignedChallenge")(function* (
    kind: SignedKind,
    who: GrownUpIdentity,
    action: string,
  ) {
    const key = toBase64Url(makeChallenge(action));
    const at = yield* now;
    yield* Ref.update(challenges, (book) => {
      const next = new Map([...book].filter(([, entry]) => entry.expiresAt > at));
      next.set(key, {
        kind,
        deviceId: who.deviceId,
        action,
        origin: "",
        rpId: "",
        expiresAt: at + PASSKEY_CHALLENGE_TTL_MS,
      });
      return next;
    });
    return key;
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
      entry.kind !== "passkey" ||
      entry.expiresAt <= at ||
      entry.deviceId !== who.deviceId ||
      entry.action !== action ||
      entry.origin !== origin
    ) {
      return yield* fail("passkey", "That Face ID check ran out. Try again.");
    }
    return entry;
  });

  /**
   * Takes a Watch's or Face ID key's challenge out of the book (one use, whatever happens next),
   * if it was made for this kind of key, this device and this action.
   */
  const spendSignedChallenge = Effect.fn("SkycotFamilyDevices.spendSignedChallenge")(function* (
    kind: SignedKind,
    who: GrownUpIdentity,
    key: string,
    action: string,
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
      entry.kind !== kind ||
      entry.expiresAt <= at ||
      entry.deviceId !== who.deviceId ||
      entry.action !== action
    ) {
      return yield* kind === "watch"
        ? fail("watch", "That check on the Watch ran out. Try again.")
        : fail("device-key", FACE_ID_RAN_OUT);
    }
    return entry;
  });

  /**
   * Checks a signed yes from the Watch or the Face ID key: spends its challenge, then checks the
   * signature with the key on this device's record, over the message rebuilt from the engine's
   * own record of the challenge (never from the phone's words).
   */
  const verifySigned = Effect.fn("SkycotFamilyDevices.verifySigned")(function* (input: {
    readonly kind: SignedKind;
    readonly who: GrownUpIdentity;
    readonly action: string;
    readonly keyId: string;
    readonly challenge: string;
    readonly signature: string;
    readonly keyOf: (
      record: SkycotFamily.FamilyDevice,
    ) => { readonly id: string; readonly publicKey: string } | undefined;
    readonly message: (challenge: string, action: string) => string;
    readonly refused: DevicesError;
  }) {
    const entry = yield* spendSignedChallenge(input.kind, input.who, input.challenge, input.action);
    const record = yield* family.device(input.who.deviceId);
    if (record === null) return yield* fail("not-allowed", SkycotFamilyGate.REMOVED_DEVICE_MESSAGE);
    const key = input.keyOf(record);
    if (key === undefined || key.id !== input.keyId) return yield* Effect.fail(input.refused);
    yield* Effect.try({
      try: () =>
        verifyWatchSignature({
          publicKey: key.publicKey,
          message: input.message(input.challenge, entry.action),
          signature: input.signature,
        }),
      catch: () => input.refused,
    });
    return record;
  });

  const WATCH_DIDNT_CONFIRM =
    "The Watch didn't confirm that. Answer on your iPhone instead, with the parent code.";
  const FACE_ID_RAN_OUT = "That Face ID check ran out. Try again.";
  const FACE_ID_DIDNT_CONFIRM = "Face ID didn't confirm that. Use the parent code instead.";

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

  const watchKeyOptions: SkycotFamilyDevices["Service"]["watchKeyOptions"] = Effect.fn(
    "SkycotFamilyDevices.watchKeyOptions",
  )(function* (input) {
    // The parent code once, so a Watch is only ever added by a grown-up (as a passkey is).
    yield* family.checkCode({ code: input.code });
    const action = watchRegisterAction(input.who.deviceId);
    const challenge = yield* issueSignedChallenge("watch", input.who, action);
    return { challenge, action, purpose: "register" as const };
  });

  const watchKeyRegister: SkycotFamilyDevices["Service"]["watchKeyRegister"] = Effect.fn(
    "SkycotFamilyDevices.watchKeyRegister",
  )(function* (input) {
    const action = watchRegisterAction(input.who.deviceId);
    yield* spendSignedChallenge("watch", input.who, input.challenge, action);
    // The Watch proves it holds the key: it signed this phone's one-use registration challenge.
    yield* Effect.try({
      try: () => {
        readWatchPublicKey(input.publicKey);
        verifyWatchSignature({
          publicKey: input.publicKey,
          message: watchSignedMessage("register", input.challenge, action),
          signature: input.signature,
        });
      },
      catch: () => new DevicesError("watch", "The Watch didn't finish setting up. Try again."),
    });
    const at = yield* now;
    const keyId = watchKeyId(input.publicKey);
    yield* family.setWatchKey({
      deviceId: input.who.deviceId,
      watch: {
        id: keyId,
        publicKey: input.publicKey,
        name: cleanName(input.name, DEVICE_NAME_MAX) ?? "Apple Watch",
        protection: input.protection,
        createdAt: DateTime.formatIso(DateTime.makeUnsafe(at)),
        lastUsedAt: null,
      },
    });
    yield* Effect.logInfo("skycot-family.watch-added", {
      deviceId: input.who.deviceId,
      protection: input.protection,
    });
    return { keyId };
  });

  const watchKeyForget: SkycotFamilyDevices["Service"]["watchKeyForget"] = (who) =>
    family.removeWatchKey({ deviceId: who.deviceId }).pipe(Effect.asVoid);

  const watchChallenge: SkycotFamilyDevices["Service"]["watchChallenge"] = Effect.fn(
    "SkycotFamilyDevices.watchChallenge",
  )(function* (input) {
    const record = yield* family.device(input.who.deviceId);
    if (record?.watch === undefined) {
      return yield* fail("watch", "This phone's Apple Watch isn't set up to say yes.");
    }
    const action = approveAction(input.threadId, input.requestId, input.fingerprint);
    const challenge = yield* issueSignedChallenge("watch", input.who, action);
    return { challenge, action, purpose: "approve" as const, keyId: record.watch.id };
  });

  const deviceKeyOptions: SkycotFamilyDevices["Service"]["deviceKeyOptions"] = Effect.fn(
    "SkycotFamilyDevices.deviceKeyOptions",
  )(function* (input) {
    // The parent code once, so a Face ID key is only ever added by a grown-up (as the Watch's).
    yield* family.checkCode({ code: input.code });
    const action = deviceKeyRegisterAction(input.who.deviceId);
    const challenge = yield* issueSignedChallenge("device-key", input.who, action);
    return { challenge, action, purpose: "register" as const };
  });

  const deviceKeyRegister: SkycotFamilyDevices["Service"]["deviceKeyRegister"] = Effect.fn(
    "SkycotFamilyDevices.deviceKeyRegister",
  )(function* (input) {
    const action = deviceKeyRegisterAction(input.who.deviceId);
    yield* spendSignedChallenge("device-key", input.who, input.challenge, action);
    // The phone proves it holds the key (and that Face ID opens it): it signed this one-use
    // registration challenge with it.
    yield* Effect.try({
      try: () => {
        readWatchPublicKey(input.publicKey);
        verifyWatchSignature({
          publicKey: input.publicKey,
          message: deviceKeySignedMessage("register", input.challenge, action),
          signature: input.signature,
        });
      },
      catch: () => new DevicesError("device-key", "Face ID didn't finish setting up. Try again."),
    });
    const at = yield* now;
    const keyId = watchKeyId(input.publicKey);
    yield* family.setDeviceKey({
      deviceId: input.who.deviceId,
      key: {
        id: keyId,
        publicKey: input.publicKey,
        biometry: input.biometry,
        createdAt: DateTime.formatIso(DateTime.makeUnsafe(at)),
        lastUsedAt: null,
      },
    });
    yield* Effect.logInfo("skycot-family.face-id-added", {
      deviceId: input.who.deviceId,
      biometry: input.biometry,
    });
    return { keyId };
  });

  const deviceKeyForget: SkycotFamilyDevices["Service"]["deviceKeyForget"] = (who) =>
    family.removeDeviceKey({ deviceId: who.deviceId }).pipe(
      Effect.tap(() =>
        Ref.update(challenges, (book) => {
          const next = new Map(book);
          for (const [key, entry] of book) {
            if (entry.deviceId === who.deviceId && entry.kind === "device-key") next.delete(key);
          }
          return next;
        }),
      ),
      Effect.asVoid,
    );

  const deviceKeyChallenge: SkycotFamilyDevices["Service"]["deviceKeyChallenge"] = Effect.fn(
    "SkycotFamilyDevices.deviceKeyChallenge",
  )(function* (input) {
    const record = yield* family.device(input.who.deviceId);
    if (record?.deviceKey === undefined) {
      return yield* fail("device-key", "Face ID isn't set up on this device yet.");
    }
    const action = approveAction(input.threadId, input.requestId, input.fingerprint);
    const challenge = yield* issueSignedChallenge("device-key", input.who, action);
    return { challenge, action, purpose: "approve" as const, keyId: record.deviceKey.id };
  });

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
    const threadsById = new Map(
      [...shell.threads, ...shell.archivedThreads].map((thread) => [thread.id, thread] as const),
    );
    const found: Array<PendingApproval> = [];
    for (const thread of shell.threads) {
      const pending = thread.pendingRuntimeRequest;
      if (pending === null) continue;
      const described = yield* gate.describeRequest({
        threadId: thread.id,
        requestId: pending.id,
      });
      if (described === null) continue;
      // A grown-up's device is for what needs a grown-up. A request the child may allow at the
      // Mac themselves ("Ask me first": list files, read, change project files, run a short
      // program) never reaches it: noise there trains a grown-up to tap yes.
      if (!described.needsGrownUp) continue;
      const createdAt = pending.createdAt.epochMilliseconds;
      const projectCovers = described.projectCovers ?? [];
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
        ...(projectCovers.length === 0
          ? {}
          : {
              projectCovers,
              projectFingerprint: fingerprintFor({
                threadId: thread.id,
                requestId: pending.id,
                what: described.what,
                why: described.why,
                scope: "project",
                covers: projectCovers,
              }),
            }),
      });
    }
    for (const ask of yield* family.pendingPageInternetAsks) {
      const thread = threadsById.get(ask.threadId as ThreadId);
      if (thread === undefined || owners[ask.threadId] !== ask.childId) continue;
      const material = pageAskMaterial(ask.childId, ask.page, ask.sites);
      const projectCovers = ["internetAssets"] as const;
      const projectFingerprint = fingerprintFor({
        threadId: ask.threadId,
        requestId: ask.id,
        what: material,
        why: PAGE_ASK_WHY,
        scope: "project",
        covers: projectCovers,
      });
      found.push({
        target: "page-internet",
        threadId: ask.threadId,
        requestId: ask.id,
        childId: ask.childId,
        threadTitle: thread.title,
        projectTitle: projectTitles.get(String(thread.projectId)) ?? null,
        createdAt: ask.createdAt,
        lapsed: ask.expiresAt <= at || at - ask.createdAt > APPROVAL_LAPSE_MS,
        needsGrownUp: true,
        why: PAGE_ASK_WHY,
        what: `${ask.page.split("/").at(-1) ?? ask.page} wants internet from ${ask.sites.join(", ")}`,
        kind: "page-internet",
        fingerprint: fingerprintFor({
          threadId: ask.threadId,
          requestId: ask.id,
          what: material,
          why: PAGE_ASK_WHY,
        }),
        projectFingerprint,
        projectCovers,
        page: ask.page,
        sites: ask.sites,
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
      return { how: "code" as const, via: null, biometry: null };
    }
    if (proof.type === "watch") {
      // Only a yes (approve:…) can be signed this way; more time stays on the phone.
      if (!action.startsWith("approve:")) {
        return yield* fail("watch", "Give more time on your iPhone, with the parent code.");
      }
      const record = yield* verifySigned({
        kind: "watch",
        who,
        action,
        keyId: proof.keyId,
        challenge: proof.challenge,
        signature: proof.signature,
        keyOf: (device) => device.watch,
        message: (challenge, signed) => watchSignedMessage("approve", challenge, signed),
        refused: new DevicesError("watch", WATCH_DIDNT_CONFIRM),
      });
      const watch = record.watch!;
      yield* family.useWatchKey({ deviceId: who.deviceId, keyId: watch.id });
      return {
        how: "watch" as const,
        via: { kind: "watch", name: watch.name } satisfies AnswerVia,
        biometry: null,
      };
    }
    if (proof.type === "device-key") {
      // Only a yes (approve:…): more time asks for the parent code, as before.
      if (!action.startsWith("approve:")) {
        return yield* fail("device-key", "Give more time with the parent code.");
      }
      const record = yield* verifySigned({
        kind: "device-key",
        who,
        action,
        keyId: proof.keyId,
        challenge: proof.challenge,
        signature: proof.signature,
        keyOf: (device) => device.deviceKey,
        message: (challenge, signed) => deviceKeySignedMessage("approve", challenge, signed),
        refused: new DevicesError("device-key", FACE_ID_DIDNT_CONFIRM),
      });
      const key = record.deviceKey!;
      yield* family.useDeviceKey({ deviceId: who.deviceId, keyId: key.id });
      return { how: "face-id" as const, via: null, biometry: key.biometry };
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
    return { how: "passkey" as const, via: null, biometry: null };
  });

  const answer: SkycotFamilyDevices["Service"]["answer"] = Effect.fn("SkycotFamilyDevices.answer")(
    function* (input) {
      if (input.requestId.startsWith("page-internet:")) {
        const ask = (yield* family.pendingPageInternetAsks).find(
          (entry) => entry.id === input.requestId && entry.threadId === input.threadId,
        );
        if (ask === undefined)
          return yield* fail("gone", "That request was already answered, or it stopped.");
        if (ask.expiresAt <= (yield* now)) {
          return yield* fail("lapsed", "This one is waiting on the Mac now. Ask again there.");
        }
        const owners = (yield* limits.today).threads;
        if (owners[ask.threadId] !== ask.childId) {
          return yield* fail("gone", "That page or conversation can't be read any more.");
        }
        const shell = yield* projections
          .getShellSnapshot({ location: "active" })
          .pipe(Effect.orElseSucceed(() => null));
        if (
          !shell?.threads.some((entry) => entry.id === ask.threadId) &&
          !shell?.archivedThreads.some((entry) => entry.id === ask.threadId)
        ) {
          return yield* fail("gone", "That page or conversation can't be read any more.");
        }
        const material = pageAskMaterial(ask.childId, ask.page, ask.sites);
        const scope = input.scope ?? "once";
        const covers = ["internetAssets"] as const;
        const fingerprint = fingerprintFor({
          threadId: ask.threadId,
          requestId: ask.id,
          what: material,
          why: PAGE_ASK_WHY,
          ...(scope === "project" ? { scope, covers } : {}),
        });
        if (fingerprint !== input.fingerprint) {
          return yield* fail(
            "changed",
            "That request changed. Have another look before you answer.",
          );
        }
        const proven =
          input.decision === "accept"
            ? yield* prove(
                input.who,
                input.origin,
                approveAction(ask.threadId, ask.id, fingerprint),
                input.proof,
              )
            : null;
        const via: AnswerVia | null =
          proven !== null
            ? proven.via
            : input.via === "watch"
              ? yield* family
                  .device(input.who.deviceId)
                  .pipe(
                    Effect.map((record) =>
                      record?.watch === undefined
                        ? null
                        : ({ kind: "watch", name: record.watch.name } satisfies AnswerVia),
                    ),
                  )
              : null;
        yield* family.settlePageInternetAsk({
          id: ask.id,
          decision: input.decision === "accept" ? "allow" : "decline",
        });
        if (input.decision === "accept" && scope === "project") {
          const thread = yield* projections
            .getThread(ask.threadId as ThreadId)
            .pipe(
              Effect.mapError(
                () => new DevicesError("gone", "That project can't be found any more."),
              ),
            );
          const project = yield* projects
            .get(thread.projectId)
            .pipe(
              Effect.mapError(
                () => new DevicesError("gone", "That project can't be found any more."),
              ),
            );
          if (Option.isNone(project) || Option.isNone(fs)) {
            return yield* fail("gone", "That project can't be found any more.");
          }
          const projectPath = yield* fs.value
            .realPath(project.value.workspaceRoot)
            .pipe(
              Effect.mapError(
                () => new DevicesError("gone", "That project can't be found any more."),
              ),
            );
          yield* family.grantProjectApproval({
            childId: ask.childId,
            projectPath,
            covers,
            grantedBy: input.who.personId,
            how:
              proven?.how === "watch"
                ? "watch"
                : proven?.how === "face-id" || proven?.how === "passkey"
                  ? "face-id"
                  : "parent-code",
          });
        }
        yield* limits.recordEvent({
          sessionId: input.sessionId,
          kind: input.decision === "accept" ? "approved" : "declined",
          threadId: ask.threadId,
          requestId: ask.id,
          childId: ask.childId,
          by: {
            personId: input.who.personId,
            deviceId: input.who.deviceId,
            deviceName: input.who.deviceName,
            ...(via === null ? {} : { via }),
            ...(proven?.how === "face-id"
              ? {
                  how: "face-id" as const,
                  ...(proven.biometry ? { biometry: proven.biometry } : {}),
                }
              : {}),
          },
        });
        yield* Effect.logInfo("skycot-family.approver-answered", {
          deviceId: input.who.deviceId,
          decision: input.decision,
          how: proven?.how ?? null,
          via: via?.kind ?? null,
          target: "page-internet",
        });
        return;
      }
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
      const scope = input.scope ?? "once";
      const covers = described.projectCovers ?? [];
      if (scope === "project" && covers.length === 0) {
        return yield* fail("changed", "This request can only be allowed once.");
      }
      const fingerprint = fingerprintFor({
        threadId: input.threadId,
        requestId: input.requestId,
        what: described.what,
        why: described.why,
        ...(scope === "project" ? { scope, covers } : {}),
      });
      if (fingerprint !== input.fingerprint) {
        return yield* fail("changed", "That request changed. Have another look before you answer.");
      }
      // Saying no is free (the approval contract, rule 6); a yes needs Face ID, the code or the
      // grown-up's own Watch.
      const proven =
        input.decision === "accept"
          ? yield* prove(
              input.who,
              input.origin,
              approveAction(input.threadId, input.requestId, fingerprint),
              input.proof,
            )
          : null;
      const how = proven?.how ?? null;
      const via: AnswerVia | null =
        proven !== null
          ? proven.via
          : input.via === "watch"
            ? yield* family
                .device(input.who.deviceId)
                .pipe(
                  Effect.map((record) =>
                    record?.watch === undefined
                      ? null
                      : ({ kind: "watch", name: record.watch.name } satisfies AnswerVia),
                  ),
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
      if (input.decision === "accept" && scope === "project") {
        const owner = (yield* limits.today).threads[input.threadId];
        const thread = yield* projections
          .getThread(threadId)
          .pipe(
            Effect.mapError(
              () => new DevicesError("gone", "That project can't be found any more."),
            ),
          );
        const project = yield* projects
          .get(thread.projectId)
          .pipe(
            Effect.mapError(
              () => new DevicesError("gone", "That project can't be found any more."),
            ),
          );
        if (owner === undefined || Option.isNone(project) || Option.isNone(fs)) {
          return yield* fail("gone", "That project can't be found any more.");
        }
        const projectPath = yield* fs.value
          .realPath(project.value.workspaceRoot)
          .pipe(
            Effect.mapError(
              () => new DevicesError("gone", "That project can't be found any more."),
            ),
          );
        const how: SkycotFamily.ProjectApprovalGrant["how"] =
          proven?.how === "face-id" || proven?.how === "watch"
            ? proven.how
            : proven?.how === "passkey"
              ? "face-id"
              : "parent-code";
        yield* family.grantProjectApproval({
          childId: owner,
          projectPath,
          covers,
          grantedBy: input.who.personId,
          how,
        });
      }
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
          ...(via === null ? {} : { via }),
          ...(proven?.how === "face-id"
            ? { how: "face-id" as const, ...(proven.biometry ? { biometry: proven.biometry } : {}) }
            : {}),
        },
      });
      yield* Effect.logInfo("skycot-family.approver-answered", {
        deviceId: input.who.deviceId,
        decision: input.decision,
        how,
        via: via?.kind ?? null,
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
    watchKeyOptions,
    watchKeyRegister,
    watchKeyForget,
    watchChallenge,
    deviceKeyOptions,
    deviceKeyRegister,
    deviceKeyForget,
    deviceKeyChallenge,
    approvals,
    challenge,
    answer,
    moreTime,
  });
});

export const layer = Layer.effect(SkycotFamilyDevices, make);
