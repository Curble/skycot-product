import { useEffect, useState } from "react";

import { resolveInitialServerAuthGateState } from "~/environments/primary/auth";
import { Button } from "~/components/ui/button";
import { StandalonePage, StandalonePageHeader } from "~/components/ui/standalone-page";

import { HomeRoute } from "./routes/Home";
import { PairRoute } from "./routes/Pair";
import { ThreadRoute } from "./routes/Thread";
import { useRoute } from "./router";

type GateState = Awaited<ReturnType<typeof resolveInitialServerAuthGateState>>;

type Gate =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
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
      (error: unknown) => {
        if (!cancelled) {
          setGate({
            status: "failed",
            message: error instanceof Error ? error.message : "Could not reach the server.",
          });
        }
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

  if (gate.status === "loading") {
    return (
      <StandalonePage tone="brand">
        <StandalonePageHeader
          eyebrow="T3 Code Simple"
          title="Connecting"
          description="Checking your session with this environment."
        />
      </StandalonePage>
    );
  }

  if (gate.status === "failed") {
    return (
      <StandalonePage tone="error">
        <StandalonePageHeader
          eyebrow="T3 Code Simple"
          title="Could not reach the server"
          description={gate.message}
        />
        <div className="mt-5">
          <Button size="sm" onClick={() => window.location.reload()}>
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

  switch (route.name) {
    case "home":
    case "pair":
      return <HomeRoute />;
    case "thread":
      return <ThreadRoute environmentId={route.environmentId} threadId={route.threadId} />;
    case "not-found":
      return (
        <StandalonePage tone="error">
          <StandalonePageHeader
            eyebrow="T3 Code Simple"
            title="Page not found"
            description={`Nothing lives at #${route.path}.`}
          />
          <div className="mt-5">
            <Button size="sm" render={<a href="#/" />}>
              Go home
            </Button>
          </div>
        </StandalonePage>
      );
  }
}
