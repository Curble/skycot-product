import { Laptop, SearchX, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { resolveInitialServerAuthGateState } from "~/environments/primary/auth";

import { AppShell } from "./app/AppShell";
import { PRODUCT_NAME } from "./brand";
import { AutomationsScreen, PeopleScreen } from "./features/stubs/Stubs";
import { HOME_HREF, useRoute } from "./router";
import { HomeRoute } from "./routes/Home";
import { PairRoute, StandalonePage } from "./routes/Pair";
import { ThreadRoute } from "./routes/Thread";
import { useColumns } from "./app/useColumns";
import { Button } from "./ui/Button";

type GateState = Awaited<ReturnType<typeof resolveInitialServerAuthGateState>>;

type Gate =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "resolved"; readonly state: GateState };

// Same gate as apps/web/src/routes/__root.tsx: probe the session over HTTP
// (exchanging a pairing token from the URL when there is one) and send an
// unauthenticated visitor to the pairing screen.
function useAuthGate(): Gate {
  const [gate, setGate] = useState<Gate>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    resolveInitialServerAuthGateState().then(
      (state) => {
        if (!cancelled) setGate({ status: "resolved", state });
      },
      () => {
        if (!cancelled) setGate({ status: "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return gate;
}

export function App() {
  const route = useRoute();
  const gate = useAuthGate();
  const columns = useColumns();

  if (gate.status === "loading") {
    return (
      <StandalonePage>
        <span className="fm-standalone__icon" aria-hidden>
          <Laptop size={30} strokeWidth={1.6} />
        </span>
        <h1 className="fm-standalone__title">Connecting to your Mac…</h1>
        <p className="fm-standalone__text">{PRODUCT_NAME} is checking your connection.</p>
      </StandalonePage>
    );
  }

  if (gate.status === "failed") {
    return (
      <StandalonePage>
        <span className="fm-standalone__icon fm-standalone__icon--danger" aria-hidden>
          <WifiOff size={30} strokeWidth={1.6} />
        </span>
        <h1 className="fm-standalone__title">Can't reach your Mac</h1>
        <p className="fm-standalone__text">
          Check the Mac that runs {PRODUCT_NAME} is awake and on the same network, then try again.
        </p>
        <div className="fm-standalone__actions">
          <Button variant="primary" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </StandalonePage>
    );
  }

  if (gate.state.status !== "authenticated") {
    return (
      <PairRoute
        auth={gate.state.auth}
        {...(gate.state.errorMessage ? { initialErrorMessage: gate.state.errorMessage } : {})}
      />
    );
  }

  return (
    <AppShell route={route}>
      {(() => {
        switch (route.name) {
          case "home":
          case "new":
          case "pair":
            return <HomeRoute />;
          case "thread":
            return (
              <ThreadRoute
                environmentId={route.environmentId}
                threadId={route.threadId}
                showBack={columns === 1}
              />
            );
          case "automations":
            return <AutomationsScreen />;
          case "people":
            return <PeopleScreen />;
          case "not-found":
            return (
              <StandalonePage>
                <span className="fm-standalone__icon fm-standalone__icon--muted" aria-hidden>
                  <SearchX size={30} strokeWidth={1.6} />
                </span>
                <h1 className="fm-standalone__title">There's nothing here</h1>
                <p className="fm-standalone__text">
                  That link doesn't go anywhere in {PRODUCT_NAME}.
                </p>
                <div className="fm-standalone__actions">
                  <Button variant="primary" onClick={() => (window.location.hash = HOME_HREF)}>
                    Go home
                  </Button>
                </div>
              </StandalonePage>
            );
        }
      })()}
    </AppShell>
  );
}
