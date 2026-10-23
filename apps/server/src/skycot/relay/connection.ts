// The Mac's one outbound connection to SKYCOT Relay. It dials out (the Mac never listens on the
// internet), proves it owns its home, then hands every frame to the protocol package's
// HostTunnel. If the connection drops it dials again with a jittered back-off, so a relay
// restart does not bring every Mac back in the same second.
//
// Plain promise code around Node's WebSocket client; SkycotRelay.ts starts and stops it.
// @effect-diagnostics globalTimers:off globalDate:off globalRandom:off

import {
  HostTunnel,
  type DeviceDirectory,
  type HostEvent,
  type TunnelHandler,
} from "@t3tools/skycot-relay/host";
import type { KeyPair } from "@t3tools/skycot-relay/noise";
import type { SigningKeyPair } from "@t3tools/skycot-relay/pass";
import { CloseCode, hostPath, type PushKind } from "@t3tools/skycot-relay/protocol";

export type ConnectionState =
  | { readonly state: "connecting" }
  | { readonly state: "connected"; readonly since: number }
  | { readonly state: "unreachable"; readonly retryAt: number }
  | { readonly state: "refused"; readonly message: string };

const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 60_000;

export interface RelayConnectionOptions {
  readonly relayUrl: string;
  readonly homeId: string;
  readonly signingKey: SigningKeyPair;
  readonly noiseKey: KeyPair;
  readonly directory: DeviceDirectory;
  readonly handler: TunnelHandler;
  readonly onState: (state: ConnectionState) => void;
  readonly onEvent: (event: HostEvent) => void;
}

export class RelayConnection {
  private socket: WebSocket | null = null;
  private tunnel: HostTunnel | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private stopped = false;
  private current: ConnectionState = { state: "connecting" };
  private readonly options: RelayConnectionOptions;

  constructor(options: RelayConnectionOptions) {
    this.options = options;
  }

  get state(): ConnectionState {
    return this.current;
  }

  connectedDevices(): ReadonlyArray<string> {
    return this.tunnel?.connectedDevices() ?? [];
  }

  start(): void {
    this.stopped = false;
    this.dial();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.tunnel?.onDisconnected();
    this.tunnel = null;
    if (socket !== null) {
      try {
        socket.close(1000, "SKYCOT Relay was switched off on the Mac.");
      } catch {
        // Already closing.
      }
    }
  }

  closeDevice(deviceRelayId: string, revokeUntilSeconds: number): void {
    this.tunnel?.revoke(deviceRelayId, revokeUntilSeconds);
  }

  push(input: { readonly ref: string; readonly kind: PushKind }) {
    return this.tunnel?.push(input) ?? Promise.resolve({ ok: false, reason: "Not connected." });
  }

  private setState(state: ConnectionState): void {
    this.current = state;
    this.options.onState(state);
  }

  private dial(): void {
    if (this.stopped) return;
    this.setState({ state: "connecting" });
    const url = new URL(this.options.relayUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = hostPath(this.options.homeId);
    let socket: WebSocket;
    try {
      socket = new WebSocket(url.toString());
    } catch {
      this.retry();
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    const tunnel = new HostTunnel({
      homeId: this.options.homeId,
      noiseKey: this.options.noiseKey,
      signingKey: this.options.signingKey,
      directory: this.options.directory,
      handler: this.options.handler,
      timers: {
        setTimeout: (run, ms) => setTimeout(run, ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      transport: {
        sendText: (text) => {
          if (socket.readyState === 1) socket.send(text);
        },
        sendBinary: (bytes) => {
          if (socket.readyState === 1) socket.send(bytes);
        },
      },
      onEvent: (event) => {
        if (event.type === "ready") {
          this.failures = 0;
          this.setState({ state: "connected", since: Date.now() });
        }
        this.options.onEvent(event);
      },
    });
    this.tunnel = tunnel;
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      if (typeof event.data === "string") tunnel.onText(event.data);
      else if (event.data instanceof ArrayBuffer) tunnel.onBinary(new Uint8Array(event.data));
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.tunnel = null;
      tunnel.onDisconnected();
      if (event.code === CloseCode.unauthorized) {
        // The relay says this Mac does not own the home: our own keys are wrong, so retrying
        // fast would not help. Try again slowly in case the relay was the one confused.
        this.setState({
          state: "refused",
          message: event.reason || "SKYCOT Relay refused this Mac.",
        });
        this.failures = Math.max(this.failures, 6);
      }
      this.retry();
    });
    socket.addEventListener("error", () => undefined);
  }

  private retry(): void {
    if (this.stopped) return;
    this.failures += 1;
    const ceiling = Math.min(MAX_RETRY_MS, MIN_RETRY_MS * 2 ** Math.min(this.failures, 10));
    const delay = Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
    if (this.current.state !== "refused") {
      this.setState({ state: "unreachable", retryAt: Date.now() + delay });
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.dial();
    }, delay);
  }
}
