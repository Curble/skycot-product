// Same shape as apps/web/src/bootstrap.ts: load the app after the React refresh
// preamble and surface boot failures before React mounts.
import { PRODUCT_NAME } from "./brand";
import { startRelayIfLinked } from "./connection/relay";

// Before anything else touches fetch or WebSocket: a linked device away from home talks to its
// Mac through SKYCOT Relay (connection/relay.ts); on the Mac's own page this does nothing.
startRelayIfLinked();

void import("./main")
  .then(({ startup }) => startup)
  .catch((error: unknown) => {
    const root = document.getElementById("root");
    if (root) {
      root.textContent = `${PRODUCT_NAME} could not start: ${error instanceof Error ? error.message : String(error)}`;
    }
  });
