/**
 * The engine's command channel: T3's own RPC protocol (`WsRpcGroup`, JSON over a WebSocket),
 * opened through a `MacTransport`. Modelled on client-runtime's bare-socket client
 * (packages/client-runtime/src/connection/outdatedHostUpdate.ts) so the wire stays exactly
 * T3's: one socket per job, closed straight after. Reads go over plain requests instead
 * (src/engine/conversations.ts), which a relay can carry as easily.
 */
import { WsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { RpcClient, RpcSerialization } from "effect/rpc";
import * as Socket from "effect/socket/Socket";

import type { MacTransport } from "./MacTransport";

const makeClient = RpcClient.make(WsRpcGroup);
export type MacRpcClient = Effect.Success<typeof makeClient>;

/** Runs one job on a fresh command channel to the Mac. */
export function withMacRpc<A, E>(
  transport: MacTransport,
  job: (client: MacRpcClient) => Effect.Effect<A, E>,
): Promise<A> {
  return transport.socket().then((socket) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* Layer.build(
            Layer.effect(
              RpcClient.Protocol,
              RpcClient.makeProtocolSocket({
                pingTimeout: "15 seconds",
                retryTransientErrors: false,
                retryPolicy: Schedule.recurs(0),
              }),
            ).pipe(
              Layer.provide(
                Layer.mergeAll(
                  Socket.layerWebSocket(socket.url, { openTimeout: "10 seconds" }).pipe(
                    Layer.provide(
                      Layer.succeed(
                        Socket.WebSocketConstructor,
                        socket.webSocketConstructor as unknown as Socket.WebSocketConstructor["Service"],
                      ),
                    ),
                  ),
                  RpcSerialization.layerJson,
                ),
              ),
            ),
          );
          const client = yield* makeClient.pipe(Effect.provide(protocol));
          return yield* job(client);
        }),
      ),
    ),
  );
}
