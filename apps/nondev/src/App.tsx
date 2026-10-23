import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { Laptop } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

import {
  peekPairingTokenFromUrl,
  resolveInitialServerAuthGateState,
  stripPairingTokenFromUrl,
} from "~/environments/primary/auth";

import { AppShell } from "./app/AppShell";
import { SidebarSheetsHost } from "./app/SidebarSheets";
import { PRODUCT_NAME } from "./brand";
import { AutomationsScreen } from "./features/automations/AutomationsScreen";
import { FamilyProvider, useFamily } from "./features/family/FamilyProvider";
import { FamilyLimitsHost } from "./features/family-limits/FamilyLimitsHost";
import { GrownUpApp } from "./features/grown-up/GrownUpApp";
import { OnboardingSheet } from "./features/onboarding/OnboardingSheet";
import { shouldShowOnboarding, welcomeEntry } from "./features/onboarding/onboarding";
import { FridgeScreen } from "./features/fridge/FridgeScreen";
import { FilesScreen } from "./features/files/FilesScreen";
import { BadgeHost, CertificateScreen, StickerBook } from "./features/badges";
import { PeopleScreen } from "./features/people/PeopleScreen";
import { useOnboardingState } from "./features/settings/localPrefs";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { HOME_HREF, navigate, useRoute, type Route } from "./router";
import { HomeRoute } from "./routes/Home";
import { enabledEnvironmentIdsAtom } from "./state/catalog";
import { serverEnvironment } from "./state/server";
import { Mascot } from "./features/brand/Mascot";
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
  const authenticated = gate.status === "resolved" && gate.state.status === "authenticated";

  // A pairing link opened in a browser that is already paired: the token was
  // consumed (or ignored) by the gate, so it must not stay in the address bar
  // where a bookmark or a share would re-send it.
  useEffect(() => {
    if (!authenticated || route.name !== "pair") return;
    if (peekPairingTokenFromUrl() !== null) stripPairingTokenFromUrl();
    navigate(HOME_HREF);
  }, [authenticated, route.name]);

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
        <span className="fm-standalone__art">
          <Mascot pose="oops" size={88} />
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
    <FamilyProvider>
      <WhoIsWho>
        <SidebarSheetsHost>
          <AppShell route={route}>
            <OnboardingGate route={route} />
            {(() => {
              switch (route.name) {
                case "home":
                case "new":
                case "pair":
                case "welcome":
                  return <HomeRoute showBack={route.name === "new" && columns === 1} />;
                case "settings":
                  return <SettingsScreen section={route.section} />;
                case "recap":
                  return <SettingsScreen section="family" recapChildId={route.childId} />;
                case "fridge":
                  return <FridgeScreen />;
                case "files":
                  return (
                    <FilesScreen
                      key={`${route.projectId}:${route.threadId ?? ""}`}
                      environmentId={route.environmentId}
                      projectId={route.projectId}
                      threadId={route.threadId}
                    />
                  );
                case "stickers":
                  return <StickerBook showBack={columns === 1} />;
                case "certificate":
                  return <CertificateScreen kind={route.kind} />;
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
                      <span className="fm-standalone__art">
                        <Mascot pose="thinking" size={88} />
                      </span>
                      {/* An h2: the title bar already carries the page's h1. */}
                      <h2 className="fm-standalone__title">There's nothing here</h2>
                      <p className="fm-standalone__text">
                        That link doesn't go anywhere in {PRODUCT_NAME}.
                      </p>
                      <div className="fm-standalone__actions">
                        <Button variant="primary" onClick={() => navigate(HOME_HREF)}>
                          Go home
                        </Button>
                      </div>
                    </StandalonePage>
                  );
              }
            })()}
          </AppShell>
          <FamilyLimitsHost />
          <BadgeHost />
        </SidebarSheetsHost>
      </WhoIsWho>
    </FamilyProvider>
  );
}

/**
 * A grown-up's own phone gets its own small app (requests, children, this device) instead of
 * the child's workspace: the engine says which device this is, never this browser.
 */
function WhoIsWho({ children }: { readonly children: React.ReactNode }) {
  const family = useFamily();
  if (family.profile.me.kind === "grown-up") {
    return <GrownUpApp />;
  }
  return <>{children}</>;
}

const EMPTY_PROVIDERS_ATOM = Atom.make<ReadonlyArray<ServerProvider> | null>(null).pipe(
  Atom.withLabel("nondev-app-providers:empty"),
);

/**
 * First-run onboarding, shown over the shell until it is finished or skipped in this browser
 * (`shouldShowOnboarding`), or whenever the person opens `#/welcome`. While the Family profile
 * is on, `#/welcome` asks for the parent code first, however it was reached (QA FK-09: typing
 * the address skipped the code the Settings row asked for). Dismissed state lives in this
 * browser; Settings can reopen it.
 */
function OnboardingGate({ route }: { readonly route: Route }) {
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const environmentId: EnvironmentId | null = environmentIds[0] ?? null;
  const providers = useAtomValue(
    environmentId === null
      ? EMPTY_PROVIDERS_ATOM
      : serverEnvironment.providersValueAtom(environmentId),
  );
  const state = useOnboardingState();
  const family = useFamily();
  const familyKnown = family.profile.source === "engine";
  const onWelcome = route.name === "welcome";
  // Judged on the engine's first answer: a parent finishing the Family step mid-sheet must not
  // close the sheet under them. (State adjusted while rendering, as React suggests for this.)
  const [familyAtStart, setFamilyAtStart] = useState<boolean | null>(null);
  if (familyAtStart === null && familyKnown) setFamilyAtStart(family.enabled);
  // `#/welcome` is decided once per visit, so the profile turning on inside it asks nothing.
  const [welcome, setWelcome] = useState<"unknown" | "open" | "closed">("unknown");
  if (!onWelcome && welcome !== "unknown") setWelcome("unknown");
  const entry = welcomeEntry(familyKnown, family.isLocked("rerunOnboarding"));
  if (onWelcome && welcome === "unknown" && entry === "open") setWelcome("open");
  const needsCode = onWelcome && welcome === "unknown" && entry === "ask";
  const asking = useRef(false);
  useEffect(() => {
    if (!needsCode || asking.current) return;
    asking.current = true;
    void family.requireParentCode("rerunOnboarding").then((ok) => {
      asking.current = false;
      setWelcome(ok ? "open" : "closed");
      if (!ok) navigate(HOME_HREF);
    });
  }, [needsCode, family]);
  // No local "dismissed" flag: closing the sheet writes the stored state and
  // leaves `#/welcome`, and both of those already make `show` false.
  const show = onWelcome
    ? welcome === "open"
    : shouldShowOnboarding(route, providers, state, familyAtStart);
  if (!show || environmentId === null) return null;
  return (
    <OnboardingSheet
      environmentId={environmentId}
      onClose={() => {
        if (route.name === "welcome") navigate(HOME_HREF);
      }}
    />
  );
}
