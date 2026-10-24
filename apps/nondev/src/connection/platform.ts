// The browser half of the engine's platform contract, cut down from
// apps/web/src/connection/platform.ts: this client only ever connects to the
// primary environment (the server that served the page, or the desktop's own
// backend). Desktop-local secondary backends, SSH environments and T3 Connect
// cloud sessions are declared unsupported rather than re-implemented.
import { ClientCapabilities, PlatformConnectionSource } from "@t3tools/client-runtime/platform";
import {
  ConnectionBlockedError,
  ConnectionTransientError,
  Connectivity,
  mapRemoteEnvironmentError,
  type PlatformConnectionRegistration,
  PrimaryConnectionRegistration,
  PrimaryConnectionTarget,
  Wakeups,
} from "@t3tools/client-runtime/connection";
import { fetchRemoteEnvironmentDescriptor } from "@t3tools/client-runtime/environment";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { APP_VERSION } from "~/branding";
import { clientPresentationMetadata } from "~/connection/clientMetadata";
import * as ConnectionStorage from "~/connection/storage";
import { readDesktopPrimaryBearerToken } from "~/environments/primary/desktopAuth";
import * as PrimaryEnvironmentHttpLayer from "~/environments/primary/httpLayer";
import {
  readPrimaryEnvironmentTarget,
  type PrimaryEnvironmentTarget,
} from "~/environments/primary/target";
import { isLocalEnvironmentDisabled } from "~/localEnvironment";
import { randomUUID } from "~/lib/utils";

function currentNetworkStatus(): "unknown" | "offline" | "online" {
  if (typeof navigator === "undefined") {
    return "unknown";
  }
  return navigator.onLine ? "online" : "offline";
}

const layerConnectivity = Connectivity.layer({
  status: Effect.sync(currentNetworkStatus),
  changes: Stream.callback((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const online = () => Queue.offerUnsafe(queue, "online");
        const offline = () => Queue.offerUnsafe(queue, "offline");
        window.addEventListener("online", online);
        window.addEventListener("offline", offline);
        return { online, offline };
      }),
      ({ online, offline }) =>
        Effect.sync(() => {
          window.removeEventListener("online", online);
          window.removeEventListener("offline", offline);
        }),
    ).pipe(Effect.asVoid),
  ),
});

// The connection banner's "Try now": the same wakeup a returning tab sends,
// which resets the retry back-off instead of waiting out a long delay.
const reconnectRequests = new Set<() => void>();
export function requestReconnect(): void {
  for (const offer of reconnectRequests) offer();
}

const layerWakeups = Wakeups.layer({
  changes: Stream.callback<"application-active" | "application-active-reconnect">((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const listener = () => {
          if (document.visibilityState === "visible") {
            Queue.offerUnsafe(queue, "application-active");
          }
        };
        const reconnect = () => {
          Queue.offerUnsafe(queue, "application-active-reconnect");
        };
        document.addEventListener("visibilitychange", listener);
        reconnectRequests.add(reconnect);
        return { listener, reconnect };
      }),
      ({ listener, reconnect }) =>
        Effect.sync(() => {
          document.removeEventListener("visibilitychange", listener);
          reconnectRequests.delete(reconnect);
        }),
    ).pipe(Effect.asVoid),
  ),
});

function clientMetadata() {
  return clientPresentationMetadata({
    appVersion: APP_VERSION,
    hosted: false,
    identity: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    },
    desktopBridge: window.desktopBridge,
  });
}

// The runtime asks for a per-browser id; nothing in this client sends it
// anywhere (Settings › Privacy says so), so the key is named for what it is.
const DEVICE_ID_KEY = "skycot:device-id";

const unsupported = (detail: string) =>
  new ConnectionBlockedError({ reason: "unsupported", detail });

const layerCapabilities = Layer.effectContext(
  Effect.sync(() => {
    const presentation = ClientCapabilities.ClientPresentation.of({
      metadata: clientMetadata(),
    });
    const cloudSession = ClientCapabilities.CloudSession.of({
      identity: Effect.succeedNone,
      clerkToken: Effect.fail(
        new ConnectionBlockedError({
          reason: "authentication",
          detail: "SKYCOT doesn't use an online account to reach your Mac.",
        }),
      ),
    });
    const identity = ClientCapabilities.RelayDeviceIdentity.of({
      deviceId: Effect.succeedNone,
    });
    const analyticsDevice = {
      id: Effect.try(() => {
        const existing = window.localStorage.getItem(DEVICE_ID_KEY);
        if (existing) return existing;
        const created = randomUUID();
        window.localStorage.setItem(DEVICE_ID_KEY, created);
        return created;
      }).pipe(Effect.option),
    };
    const primaryAuth = ClientCapabilities.PrimaryEnvironmentAuth.of({
      bearerToken: Effect.tryPromise({
        try: readDesktopPrimaryBearerToken,
        catch: (cause) =>
          new ConnectionTransientError({
            reason: "remote-unavailable",
            detail: `Could not load the desktop primary credential: ${String(cause)}`,
          }),
      }).pipe(Effect.map(Option.fromNullishOr)),
    });
    const ssh = ClientCapabilities.SshEnvironmentGateway.of({
      provision: () =>
        Effect.fail(unsupported("SSH environments are not available in the simple client.")),
      prepare: () =>
        Effect.fail(unsupported("SSH environments are not available in the simple client.")),
      disconnect: () => Effect.void,
    });

    return Context.make(ClientCapabilities.CloudSession, cloudSession).pipe(
      Context.add(ClientCapabilities.AnalyticsDevice, analyticsDevice),
      Context.add(ClientCapabilities.PrimaryEnvironmentAuth, primaryAuth),
      Context.add(ClientCapabilities.RelayDeviceIdentity, identity),
      Context.add(ClientCapabilities.ClientPresentation, presentation),
      Context.add(ClientCapabilities.SshEnvironmentGateway, ssh),
    );
  }),
);

const loadPrimaryConnectionRegistration = Effect.fn(
  "nondev.connectionPlatform.loadPrimaryConnectionRegistration",
)(function* (resolved: PrimaryEnvironmentTarget) {
  const descriptor = yield* fetchRemoteEnvironmentDescriptor({
    httpBaseUrl: resolved.target.httpBaseUrl,
  }).pipe(
    Effect.provide(PrimaryEnvironmentHttpLayer.layer),
    Effect.mapError(mapRemoteEnvironmentError),
  );
  return new PrimaryConnectionRegistration({
    target: new PrimaryConnectionTarget({
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      httpBaseUrl: resolved.target.httpBaseUrl,
      wsBaseUrl: resolved.target.wsBaseUrl,
    }),
  });
});

// The target itself is static for this client, but discovering it needs the
// server to answer. Polling at the stock cadence makes a server that comes up
// late (or a dev restart) register without a page reload.
const PLATFORM_POLL_INTERVAL = "3 seconds";

const layerPlatformConnectionSource = Layer.effect(
  PlatformConnectionSource.PlatformConnectionSource,
  Effect.gen(function* () {
    if (isLocalEnvironmentDisabled()) {
      return PlatformConnectionSource.PlatformConnectionSource.of({
        registrations: Stream.empty,
      });
    }
    const cacheRef = yield* Ref.make<{
      readonly signature: string;
      readonly registration: PlatformConnectionRegistration;
    } | null>(null);

    const buildPlatformRegistrations = Effect.gen(function* () {
      const target = yield* Effect.try(readPrimaryEnvironmentTarget).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("Could not read the primary environment topology.", { cause }),
        ),
        Effect.option,
      );
      if (Option.isNone(target) || target.value === null) {
        return [] as ReadonlyArray<PlatformConnectionRegistration>;
      }
      const signature = `primary|${target.value.target.httpBaseUrl}|${target.value.target.wsBaseUrl}`;
      const cached = yield* Ref.get(cacheRef);
      if (cached !== null && cached.signature === signature) {
        return [cached.registration];
      }
      const built = yield* loadPrimaryConnectionRegistration(target.value).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("Could not discover the primary environment.", { error }),
        ),
        Effect.option,
      );
      if (Option.isNone(built)) {
        return [];
      }
      yield* Ref.set(cacheRef, { signature, registration: built.value });
      return [built.value];
    });

    return PlatformConnectionSource.PlatformConnectionSource.of({
      registrations: Stream.tick(PLATFORM_POLL_INTERVAL).pipe(
        Stream.mapEffect(() => buildPlatformRegistrations),
      ),
    });
  }),
);

type ConnectionPlatformLayerSource =
  | typeof ConnectionStorage.layer
  | typeof layerConnectivity
  | typeof layerWakeups
  | typeof layerCapabilities
  | typeof layerPlatformConnectionSource;

export const layer: Layer.Layer<
  Layer.Success<ConnectionPlatformLayerSource>,
  Layer.Error<ConnectionPlatformLayerSource>,
  Layer.Services<ConnectionPlatformLayerSource>
> = Layer.mergeAll(
  ConnectionStorage.layer,
  layerConnectivity,
  layerWakeups,
  layerCapabilities,
  layerPlatformConnectionSource,
);
