// SKYCOT Relay on the Mac: off until a grown-up turns it on in Settings › Family, and only
// possible in a build that names a relay (`SKYCOT_RELAY_URL`, set by the brand once Curble runs
// one; docs/nondev/RELAY.md). When on, the engine keeps one outbound connection to the relay
// under its own home id (connection.ts), serves linked devices through the sealed tunnel
// (tunnelHandler.ts) with the same sign-ins and rules as at home, puts the relay's address and
// keys into new device links, and asks the relay for content-free notifications.
//
// The relay is never a judge: who a device is stays its T3 session (Phase 1, WHO-IS-WHO.md),
// checked by the engine on every request. What this service adds is the tunnel's own door: a
// relay id this Mac issued, the device's tunnel key, a fresh hello, a device the Family profile
// still has.

import type { AuthSessionId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import { HttpServerRequest } from "effect/http";

import { randomBytes, toBase64Url } from "@t3tools/skycot-relay/encoding";
import type { DeviceDirectory, HostEvent, TunnelContext } from "@t3tools/skycot-relay/host";
import { isAllowedRelayUrl, normaliseRelayUrl, relayLinkParams } from "@t3tools/skycot-relay/link";
import { keyPairFromSecret } from "@t3tools/skycot-relay/noise";
import {
  homeIdFor,
  newDeviceRelayId,
  signingKeyPairFromSecret,
  signPass,
} from "@t3tools/skycot-relay/pass";
import type { PushKind } from "@t3tools/skycot-relay/protocol";
import { deviceIdFromSubject } from "@t3tools/skycot-rules/people";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as SkycotFamilyDevices from "../family-devices/SkycotFamilyDevices.ts";
import * as SkycotFamilyLimits from "../family-limits/SkycotFamilyLimits.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
import { RelayConnection, type ConnectionState } from "./connection.ts";
import {
  addPushRef,
  admit,
  decodeRelayFile,
  encodeRelayFile,
  PASS_LIFETIME_SECONDS,
  RELAY_FILE_NAME,
  reserve,
  updateDevice,
  vanished,
  withoutDevices,
  type RelayFile,
} from "./relayFile.ts";
import { makeTunnelHandler } from "./tunnelHandler.ts";

export const RELAY_URL_ENV = "SKYCOT_RELAY_URL";
/** Where a linked browser opens the app (Phase 2); the iOS app (Phase 3) needs no page. */
export const RELAY_APP_URL_ENV = "SKYCOT_RELAY_APP_URL";

const SIGNING_SECRET = "skycot-relay-signing-key";
const TUNNEL_SECRET = "skycot-relay-tunnel-key";
const WATCH_EVERY = Duration.seconds(10);

export type RelayState =
  | "not-available"
  | "off"
  | "connecting"
  | "connected"
  | "unreachable"
  | "refused";

export interface RelayStatus {
  /** A relay address is part of this build. */
  readonly available: boolean;
  readonly enabled: boolean;
  readonly state: RelayState;
  /** The relay's host name, for "Connected through relay.skycot.com". */
  readonly relayHost: string | null;
  /** Linked devices that have used the relay. */
  readonly devicesLinked: number;
  /** Devices connected through the relay right now. */
  readonly devicesOnline: number;
}

export class SkycotRelay extends Context.Service<
  SkycotRelay,
  {
    readonly status: Effect.Effect<RelayStatus>;
    readonly setEnabled: (enabled: boolean) => Effect.Effect<RelayStatus, SkycotFamily.FamilyError>;
    /**
     * The relay part of a new device link (`relay=…&hk=…&nk=…&d=…&p=…`) and the page it opens,
     * while the relay is on; `None` otherwise.
     */
    readonly linkFor: (familyDeviceId: string) => Effect.Effect<
      Option.Option<{
        readonly appUrl: string;
        readonly params: ReadonlyArray<[string, string]>;
        readonly connected: boolean;
      }>,
      SkycotFamily.FamilyError
    >;
    /** Ends relay access for devices the Family profile no longer has. */
    readonly forgetVanished: Effect.Effect<void>;
    /** A content-free notification to some devices; how many were sent. */
    readonly notify: (input: {
      readonly familyDeviceIds: ReadonlyArray<string>;
      readonly kind: PushKind;
    }) => Effect.Effect<number>;
  }
>()("t3/skycot/relay/SkycotRelay") {}

/** Where the engine's own server answers on this Mac. */
export function loopbackOriginFor(config: {
  readonly host: string | undefined;
  readonly port: number;
}) {
  const host = config.host?.trim() ?? "";
  const wildcard = host === "" || host === "0.0.0.0" || host === "::" || host === "[::]";
  if (wildcard || host === "localhost" || host.startsWith("127."))
    return `http://127.0.0.1:${config.port}`;
  if (host === "::1" || host === "[::1]") return `http://[::1]:${config.port}`;
  return `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${config.port}`;
}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const family = yield* SkycotFamily.SkycotFamily;
  const devices = yield* Effect.serviceOption(SkycotFamilyDevices.SkycotFamilyDevices);
  const limits = yield* Effect.serviceOption(SkycotFamilyLimits.SkycotFamilyLimits);
  const projections = yield* Effect.serviceOption(ProjectionStore.ProjectionStoreV2);

  const configuredUrl = yield* Config.String(RELAY_URL_ENV).pipe(Config.option);
  const configuredAppUrl = yield* Config.String(RELAY_APP_URL_ENV).pipe(Config.option);
  const relayUrl =
    Option.isSome(configuredUrl) && isAllowedRelayUrl(configuredUrl.value.trim())
      ? normaliseRelayUrl(configuredUrl.value.trim())
      : null;
  const appUrl =
    Option.isSome(configuredAppUrl) && isAllowedRelayUrl(configuredAppUrl.value.trim())
      ? normaliseRelayUrl(configuredAppUrl.value.trim())
      : relayUrl;
  if (Option.isSome(configuredUrl) && configuredUrl.value.trim() !== "" && relayUrl === null) {
    yield* Effect.logWarning("skycot-relay.address-refused", {
      reason: "must be https (or http to this Mac for testing)",
    });
  }

  const filePath = path.join(config.stateDir, RELAY_FILE_NAME);
  const lock = yield* Semaphore.make(1);
  const loopbackOrigin = loopbackOriginFor(config);

  const read = fs.readFileString(filePath).pipe(
    Effect.map(decodeRelayFile),
    Effect.orElseSucceed(() => decodeRelayFile("")),
  );
  const write = Effect.fn("SkycotRelay.write")(
    function* (file: RelayFile) {
      yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${toBase64Url(randomBytes(6))}.tmp`;
      yield* fs.writeFileString(temp, `${yield* encodeRelayFile(file)}\n`, { mode: 0o600 });
      yield* fs.rename(temp, filePath);
    },
    Effect.mapError((cause) => new SkycotFamily.FamilyError({ reason: "storage", cause })),
  );
  /** One read-change-write under the lock. */
  const change = <A>(run: (file: RelayFile) => { readonly file: RelayFile; readonly result: A }) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const before = yield* read;
        const { file, result } = run(before);
        if (file !== before) yield* write(file);
        return result;
      }),
    );

  const keys = Effect.gen(function* () {
    const signing = signingKeyPairFromSecret(yield* secrets.getOrCreateRandom(SIGNING_SECRET, 32));
    const noise = keyPairFromSecret(yield* secrets.getOrCreateRandom(TUNNEL_SECRET, 32));
    return { signing, noise, homeId: homeIdFor(signing.publicKey) };
  }).pipe(Effect.mapError((cause) => new SkycotFamily.FamilyError({ reason: "storage", cause })));

  const familyDeviceIds = family.status.pipe(
    Effect.map((status) =>
      status.enabled ? new Set(status.devices.map((device) => device.id)) : new Set<string>(),
    ),
    Effect.orElseSucceed(() => new Set<string>()),
  );

  const connectionState = yield* Ref.make<ConnectionState | null>(null);
  const connection = yield* Ref.make<RelayConnection | null>(null);
  const context = yield* Effect.context<never>();
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseWith(context)(effect);

  const directory: DeviceDirectory = {
    admit: (input) =>
      run(
        Effect.gen(function* () {
          const ids = yield* familyDeviceIds;
          return yield* change((file) => {
            const outcome = admit(file, { ...input, familyDeviceIds: ids });
            return { file: outcome.file, result: outcome.admission };
          });
        }).pipe(
          Effect.orElseSucceed(
            () => ({ ok: false, reason: "The Mac could not check that device." }) as const,
          ),
        ),
      ),
  };

  const familyDeviceFor = Effect.fn("SkycotRelay.familyDeviceFor")(function* (
    deviceRelayId: string,
  ) {
    const file = yield* read;
    const ids = yield* familyDeviceIds;
    const record = file.devices.find((device) => device.relayId === deviceRelayId);
    return record !== undefined && ids.has(record.familyDeviceId) ? record.familyDeviceId : null;
  });

  const authenticate = (input: {
    readonly path: string;
    readonly headers: ReadonlyArray<readonly [string, string]>;
    readonly upgrade: boolean;
  }) => {
    const request = HttpServerRequest.fromWeb(
      new Request(`${loopbackOrigin}${input.path}`, {
        headers: input.headers.map(([name, value]) => [name, value]),
      }),
    );
    return (
      input.upgrade
        ? auth.authenticateWebSocketUpgrade(request)
        : auth.authenticateHttpRequest(request)
    ).pipe(
      Effect.map((session) => ({ sessionId: String(session.sessionId), subject: session.subject })),
      Effect.orElseSucceed(() => null),
    );
  };

  const control = Effect.fn("SkycotRelay.control")(function* (
    tunnel: TunnelContext,
    request: Record<string, unknown>,
  ) {
    const op = request["op"];
    if (op === "renew-pass") {
      const owner = yield* familyDeviceFor(tunnel.deviceRelayId);
      if (owner === null) return { error: "removed" };
      const { signing, homeId } = yield* keys;
      const expiresAt = Math.floor((yield* Clock.currentTimeMillis) / 1000) + PASS_LIFETIME_SECONDS;
      yield* change((file) => ({
        file: updateDevice(file, tunnel.deviceRelayId, (device) => ({
          ...device,
          passExpiresAt: expiresAt,
        })),
        result: undefined,
      }));
      return {
        pass: signPass(signing, { homeId, deviceRelayId: tunnel.deviceRelayId, expiresAt }),
      };
    }
    if (op === "push-ref") {
      const ref = request["ref"];
      const type = request["type"];
      if (
        typeof ref !== "string" ||
        ref.length > 600 ||
        (type !== "alert" && type !== "liveactivity")
      ) {
        return { ok: false };
      }
      yield* change((file) => ({
        file: updateDevice(file, tunnel.deviceRelayId, (device) => addPushRef(device, ref, type)),
        result: undefined,
      }));
      return { ok: true };
    }
    return { error: "unknown" };
  });

  const handler = makeTunnelHandler({
    loopbackOrigin,
    authenticate: (input) => run(authenticate(input)),
    familyDeviceFor: (deviceRelayId) => run(familyDeviceFor(deviceRelayId)),
    familyDeviceOf: deviceIdFromSubject,
    revokeSession: (sessionId) =>
      run(auth.revokeSession(sessionId as AuthSessionId).pipe(Effect.ignore)),
    control: (tunnel, request) =>
      run(control(tunnel, request).pipe(Effect.orElseSucceed(() => ({ error: "failed" })))),
    log: (event, fields) => {
      void run(Effect.logInfo(event, fields));
    },
  });

  const onEvent = (event: HostEvent) => {
    if (event.type === "refused") {
      void run(Effect.logInfo("skycot-relay.device-refused", { reason: event.reason }));
    } else if (event.type === "relay-error") {
      void run(Effect.logWarning("skycot-relay.relay-error", { message: event.message }));
    }
  };

  const stopConnection = Effect.gen(function* () {
    const current = yield* Ref.getAndSet(connection, null);
    if (current !== null) current.stop();
    yield* Ref.set(connectionState, null);
  });

  const startConnection = Effect.gen(function* () {
    if (relayUrl === null) return;
    yield* stopConnection;
    const { signing, noise, homeId } = yield* keys;
    const next = new RelayConnection({
      relayUrl,
      homeId,
      signingKey: signing,
      noiseKey: noise,
      directory,
      handler,
      onState: (state) => {
        void run(Ref.set(connectionState, state));
      },
      onEvent,
    });
    yield* Ref.set(connection, next);
    next.start();
    yield* Effect.logInfo("skycot-relay.started", { home: homeId.slice(0, 6) });
  });

  const status: SkycotRelay["Service"]["status"] = Effect.gen(function* () {
    const file = yield* read;
    const state = yield* Ref.get(connectionState);
    const live = yield* Ref.get(connection);
    const relayState: RelayState =
      relayUrl === null
        ? "not-available"
        : !file.enabled
          ? "off"
          : state === null
            ? "connecting"
            : state.state;
    return {
      available: relayUrl !== null,
      enabled: file.enabled && relayUrl !== null,
      state: relayState,
      relayHost: relayUrl === null ? null : new URL(relayUrl).host,
      devicesLinked: file.devices.filter((device) => device.key !== null).length,
      devicesOnline: new Set(live?.connectedDevices() ?? []).size,
    };
  });

  const setEnabled: SkycotRelay["Service"]["setEnabled"] = Effect.fn("SkycotRelay.setEnabled")(
    function* (enabled) {
      if (relayUrl === null) return yield* status;
      yield* change((file) => ({
        file: file.enabled === enabled ? file : { ...file, enabled },
        result: undefined,
      }));
      if (enabled) yield* startConnection;
      else yield* stopConnection;
      yield* Effect.logInfo("skycot-relay.switched", { enabled });
      return yield* status;
    },
  );

  const linkFor: SkycotRelay["Service"]["linkFor"] = Effect.fn("SkycotRelay.linkFor")(
    function* (familyDeviceId) {
      if (relayUrl === null || appUrl === null) return Option.none();
      const file = yield* read;
      if (!file.enabled) return Option.none();
      const { signing, noise, homeId } = yield* keys;
      const deviceRelayId = newDeviceRelayId();
      const nowSeconds = Math.floor((yield* Clock.currentTimeMillis) / 1000);
      yield* change((current) => ({
        file: reserve(current, { relayId: deviceRelayId, familyDeviceId, nowSeconds }),
        result: undefined,
      }));
      const pass = signPass(signing, {
        homeId,
        deviceRelayId,
        expiresAt: nowSeconds + PASS_LIFETIME_SECONDS,
      });
      const state = yield* Ref.get(connectionState);
      return Option.some({
        appUrl,
        connected: state?.state === "connected",
        params: relayLinkParams({
          relayUrl,
          hostSigningKey: toBase64Url(signing.publicKey),
          hostNoiseKey: toBase64Url(noise.publicKey),
          deviceRelayId,
          pass,
        }),
      });
    },
  );

  const forgetVanished: SkycotRelay["Service"]["forgetVanished"] = Effect.gen(function* () {
    const ids = yield* familyDeviceIds;
    const nowSeconds = Math.floor((yield* Clock.currentTimeMillis) / 1000);
    const gone = yield* change((file) => {
      const list = vanished(file, ids, nowSeconds);
      return {
        file:
          list.length === 0
            ? file
            : withoutDevices(file, new Set(list.map((device) => device.relayId))),
        result: list,
      };
    });
    const live = yield* Ref.get(connection);
    for (const device of gone) live?.closeDevice(device.relayId, device.passExpiresAt);
    if (gone.length > 0)
      yield* Effect.logInfo("skycot-relay.devices-forgotten", { count: gone.length });
  }).pipe(Effect.ignoreCause({ log: true }));

  const notify: SkycotRelay["Service"]["notify"] = Effect.fn("SkycotRelay.notify")(
    function* (input) {
      const live = yield* Ref.get(connection);
      if (live === null || live.state.state !== "connected") return 0;
      const wanted = new Set(input.familyDeviceIds);
      const type =
        input.kind === "activity-update" || input.kind === "activity-end"
          ? "liveactivity"
          : "alert";
      const file = yield* read;
      const targets = file.devices.flatMap((device) =>
        wanted.has(device.familyDeviceId)
          ? device.push
              .filter((entry) => entry.type === type)
              .map((entry) => ({ relayId: device.relayId, ref: entry.ref }))
          : [],
      );
      let sent = 0;
      for (const target of targets) {
        const outcome = yield* Effect.promise(() =>
          live.push({ ref: target.ref, kind: input.kind }),
        );
        if (outcome.ok) sent += 1;
        else if (outcome.reason === "gone" || outcome.reason === "bad-ref") {
          yield* change((current) => ({
            file: updateDevice(current, target.relayId, (device) => ({
              ...device,
              push: device.push.filter((entry) => entry.ref !== target.ref),
            })),
            result: undefined,
          })).pipe(Effect.ignore);
        }
      }
      return sent;
    },
  );

  // What the watcher has already told devices about, so each request and each finish is one
  // notification. Kept in memory: after a restart the first look only records what it sees.
  const announced = yield* Ref.make<{
    readonly requests: ReadonlySet<string>;
    readonly finished: ReadonlyMap<string, number> | null;
  }>({ requests: new Set(), finished: null });

  const watch = Effect.gen(function* () {
    yield* forgetVanished;
    const live = yield* Ref.get(connection);
    if (live === null || live.state.state !== "connected") return;
    const status = yield* family.status.pipe(Effect.orElseSucceed(() => null));
    if (status === null || !status.enabled) return;
    const grownUpDevices = status.devices
      .filter((device) => device.kind === "grown-up")
      .map((device) => device.id);

    if (Option.isSome(devices) && grownUpDevices.length > 0) {
      const pending = (yield* devices.value.approvals).filter(
        (request) => request.needsGrownUp && !request.lapsed,
      );
      const seen = (yield* Ref.get(announced)).requests;
      const fresh = pending.filter((request) => !seen.has(request.requestId));
      if (fresh.length > 0)
        yield* notify({ familyDeviceIds: grownUpDevices, kind: "needs-grown-up" });
      yield* Ref.update(announced, (current) => ({
        ...current,
        requests: new Set(pending.map((request) => request.requestId)),
      }));
    }

    if (Option.isSome(projections) && Option.isSome(limits)) {
      const shell = yield* projections.value
        .getShellSnapshot({ location: "active" })
        .pipe(Effect.orElseSucceed(() => null));
      if (shell === null) return;
      const owners = (yield* limits.value.today).threads;
      const completed = new Map<string, number>();
      for (const thread of shell.threads) {
        const at = thread.latestRunCompletedAt?.epochMilliseconds;
        if (at !== undefined && owners[thread.id] !== undefined) completed.set(thread.id, at);
      }
      const before = (yield* Ref.get(announced)).finished;
      if (before !== null) {
        const finishedChildren = new Set<string>();
        for (const [threadId, at] of completed) {
          if ((before.get(threadId) ?? 0) < at) finishedChildren.add(owners[threadId]!);
        }
        const childDevices = status.devices
          .filter((device) => device.kind === "child" && finishedChildren.has(device.personId))
          .map((device) => device.id);
        if (childDevices.length > 0)
          yield* notify({ familyDeviceIds: childDevices, kind: "finished" });
      }
      yield* Ref.update(announced, (current) => ({ ...current, finished: completed }));
    }
  }).pipe(Effect.ignoreCause({ log: true }));

  yield* Effect.forkScoped(watch.pipe(Effect.repeat(Schedule.spaced(WATCH_EVERY))));
  yield* Effect.addFinalizer(() => stopConnection);

  const initial = yield* read;
  if (initial.enabled && relayUrl !== null) {
    yield* startConnection.pipe(Effect.ignoreCause({ log: true }));
  }

  return SkycotRelay.of({ status, setEnabled, linkFor, forgetVanished, notify });
});

export const layer = Layer.effect(SkycotRelay, make).pipe(
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ProjectionStore.layer),
);
