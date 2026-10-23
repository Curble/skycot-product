#!/usr/bin/env node
// A real-runtime check of the relay: a pretend Mac and a pretend phone talk through a relay
// started with `pnpm run dev` (wrangler dev --local, on this Mac only), using the same protocol
// code as the engine and the apps. Usage: node e2e/relay-smoke.ts http://127.0.0.1:8799
import { newHomeRecord, RelayHome } from "@t3tools/skycot-relay/client/home";
import { toBase64Url, utf8 } from "@t3tools/skycot-relay/encoding";
import { HostTunnel } from "@t3tools/skycot-relay/host";
import { generateKeyPair } from "@t3tools/skycot-relay/noise";
import {
  generateSigningKeyPair,
  homeIdFor,
  newDeviceRelayId,
  signPass,
} from "@t3tools/skycot-relay/pass";
import { hostPath } from "@t3tools/skycot-relay/protocol";

const relayUrl = process.argv[2] ?? "http://127.0.0.1:8799";
const timers = {
  setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const signingKey = generateSigningKeyPair();
const noiseKey = generateKeyPair();
const homeId = homeIdFor(signingKey.publicKey);
const deviceRelayId = newDeviceRelayId();

const hostSocket = new WebSocket(`${relayUrl.replace(/^http/, "ws")}${hostPath(homeId)}`);
hostSocket.binaryType = "arraybuffer";
const ready = new Promise<void>((resolve, reject) => {
  const tunnel = new HostTunnel({
    homeId,
    noiseKey,
    signingKey,
    timers,
    directory: { admit: async () => ({ ok: true, mode: "linked" }) },
    handler: {
      request: async (_context, head) => ({
        status: 200,
        headers: [["content-type", "text/plain"]],
        body: utf8(`the Mac answered ${head.method} ${head.path}`),
      }),
      socket: async (_context, _open, peer) => ({
        protocol: "",
        send: (data) => peer.message(data),
        close: () => undefined,
      }),
      control: async () => ({}),
    },
    transport: {
      sendText: (text) => hostSocket.send(text),
      sendBinary: (bytes) => hostSocket.send(bytes),
    },
    onEvent: (event) => {
      if (event.type === "ready") resolve();
      if (event.type === "relay-error") reject(new Error(event.message));
    },
  });
  hostSocket.addEventListener("message", (event) => {
    if (typeof event.data === "string") tunnel.onText(event.data);
    else tunnel.onBinary(new Uint8Array(event.data as ArrayBuffer));
  });
  hostSocket.addEventListener("close", (event) =>
    reject(new Error(`host closed ${event.code} ${event.reason}`)),
  );
});
await ready;

const home = new RelayHome({
  record: newHomeRecord({
    relayUrl,
    hostSigningKey: toBase64Url(signingKey.publicKey),
    hostNoiseKey: toBase64Url(noiseKey.publicKey),
    deviceRelayId,
    pass: signPass(signingKey, {
      homeId,
      deviceRelayId,
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    }),
    homeId,
    token: null,
  }),
  save: () => undefined,
  timers,
});
const answer = await home.fetch("https://home.invalid/api/hello?from=smoke");
const text = await answer.text();
const socket = new home.WebSocket("wss://home.invalid/ws");
const echoed = await new Promise<string>((resolve, reject) => {
  socket.addEventListener("open", () => socket.send("ping through the relay"));
  socket.addEventListener("message", (event: { data: unknown }) => resolve(String(event.data)));
  socket.addEventListener("close", (event: { code: number }) =>
    reject(new Error(`socket closed ${event.code}`)),
  );
});
console.log(JSON.stringify({ homeId: homeId.slice(0, 6), status: answer.status, text, echoed }));
socket.close();
home.close();
hostSocket.close();
if (text !== "the Mac answered GET /api/hello?from=smoke" || echoed !== "ping through the relay")
  process.exit(1);
