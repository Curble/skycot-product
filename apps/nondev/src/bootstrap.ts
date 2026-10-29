// Same shape as apps/web/src/bootstrap.ts: load the app after the React refresh
// preamble and surface boot failures before React mounts.
import { PRODUCT_NAME } from "./brand";
import { readGrownUpSessionId } from "./features/family/grownUpSession";
import { restoreUnlockProofOnBoot } from "./features/family/unlockProof";
import { startRelayIfLinked } from "./connection/relay";

// Before anything else touches fetch or WebSocket: a linked device away from home talks to its
// Mac through SKYCOT Relay (connection/relay.ts); on the Mac's own page this does nothing.
startRelayIfLinked();

// A grown-up's proof parked by SKYCOT's own restart is taken (and deleted) before any engine call.
restoreUnlockProofOnBoot(readGrownUpSessionId());

void import("./main")
  .then(({ startup }) => startup)
  .catch(() => {
    const root = document.getElementById("root");
    if (root) {
      const message = document.createElement("p");
      message.textContent = `${PRODUCT_NAME} couldn't open just now.`;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => window.location.reload());
      root.replaceChildren(message, retry);
    }
  });
