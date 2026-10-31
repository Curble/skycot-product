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
import { grownUpSessionFor, useGrownUpSessionId } from "./features/family/grownUpSession";
import { FamilyLimitsHost } from "./features/family-limits/FamilyLimitsHost";
import { GrownUpApp } from "./features/grown-up/GrownUpApp";
import { OnboardingSheet } from "./features/onboarding/OnboardingSheet";
import { isSetupOpen, shouldShowOnboarding, welcomeEntry } from "./features/onboarding/onboarding";
import { FridgeScreen } from "./features/fridge/FridgeScreen";
import { MakesScreen } from "./features/home/MakesScreen";
import { FilesScreen } from "./features/files/FilesScreen";
import { BadgeHost, CertificateScreen, StickerBook } from "./features/badges";
import { PeopleScreen } from "./features/people/PeopleScreen";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { HOME_HREF, navigate, useRoute, type Route } from "./router";
import { HomeRoute } from "./routes/Home";
import { enabledEnvironmentIdsAtom } from "./state/catalog";
import { serverEnvironment } from "./state/server";
import { Mascot } from "./features/brand/Mascot";
import { PairRoute, StandalonePage } from "./routes/Pair";
import { ThreadRoute } from "./routes/Thread";
import { useColumns } from "./app/useColumns";
import { useChildView } from "./app/useChildView";
import {
  grownUpSeen,
  grownUpTurnRestarts,
  markFreshStart,
  markGrownUpSeen,
} from "./features/family-limits/freshStart";
import { startFreshWindow } from "./features/family-limits/store";
import { landsHomeAfterGrownUp, routeForViewer } from "./routeGuard";
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
        <HandBackHome />
        <SidebarSheetsHost>
          <ShellOrWelcome route={route}>
            <AppShell route={route}>
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
                  case "makes":
                    return <MakesScreen showBack={columns === 1} />;
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
                    return (
                      <GrownUpOnly route={route}>
                        <AutomationsScreen />
                      </GrownUpOnly>
                    );
                  case "people":
                    return (
                      <GrownUpOnly route={route}>
                        <PeopleScreen />
                      </GrownUpOnly>
                    );
                  case "not-found":
                    return <NothingHere />;
                }
              })()}
            </AppShell>
          </ShellOrWelcome>
          <FamilyLimitsHost />
          <BadgeHost />
        </SidebarSheetsHost>
      </WhoIsWho>
    </FamilyProvider>
  );
}

/** The page for an address that goes nowhere (for a child, also every grown-up-only address). */
function NothingHere() {
  return (
    <StandalonePage>
      <span className="fm-standalone__art">
        <Mascot pose="thinking" size={88} />
      </span>
      {/* An h2: the title bar already carries the page's h1. */}
      <h2 className="fm-standalone__title">There's nothing here</h2>
      <p className="fm-standalone__text">That link doesn't go anywhere in {PRODUCT_NAME}.</p>
      <div className="fm-standalone__actions">
        <Button variant="primary" onClick={() => navigate(HOME_HREF)}>
          Go home
        </Button>
      </div>
    </StandalonePage>
  );
}

/**
 * A child who types a grown-up page's address gets the same "There's nothing here" page as any
 * unknown address, never a redirect and never a hint the page exists; the page's own component
 * never mounts for them, so nothing behind it is asked for.
 */
function GrownUpOnly({
  route,
  children,
}: {
  readonly route: Route;
  readonly children: React.ReactNode;
}) {
  const childView = useChildView();
  // Until the engine has said whether the Family profile is on, the page stays unmounted.
  const known = useFamily().profile.source === "engine";
  const verdict = routeForViewer(route, childView);
  if (!known) return null;
  return verdict.allowed ? <>{children}</> : <NothingHere />;
}

/** When the grown-up's turn on the shared Mac ends, the child lands on Home, never on the grown-up page left open. */
function HandBackHome() {
  const family = useFamily();
  const grownUp = grownUpSessionFor(useGrownUpSessionId(), family.profile, Date.now()) !== null;
  const was = useRef(grownUp);
  useEffect(() => {
    if (landsHomeAfterGrownUp(was.current, grownUp)) navigate(HOME_HREF);
    was.current = grownUp;
    // The engine's lists were filtered for the child when they were fetched: restart once so the
    // grown-up sees every child's projects (the same reload also clears the cache on the way back).
    // Not while the welcome steps are up: the parent code opens this turn mid set-up.
    if (grownUpTurnRestarts(grownUp, grownUpSeen(), isSetupOpen())) {
      markGrownUpSeen();
      const timer = window.setTimeout(() => startFreshWindow(window, markFreshStart, null), 400);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [grownUp]);
  return null;
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
 * The welcome owns the window while it is open: it is rendered instead of the shell, and the
 * shell mounts when it closes. It opens on a first run (the engine says the welcome was never
 * finished or skipped and the Family profile is off, `shouldShowOnboarding`), or whenever the
 * person opens `#/welcome`. While the Family profile is on, `#/welcome` asks for the parent
 * code first, however it was reached (QA FK-09: typing the address skipped the code the
 * Settings row asked for). Whether the first run is over lives in the Mac's SKYCOT data, never
 * in this browser.
 */
function ShellOrWelcome({
  route,
  children,
}: {
  readonly route: Route;
  readonly children: React.ReactNode;
}) {
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const environmentId: EnvironmentId | null = environmentIds[0] ?? null;
  const providers = useAtomValue(
    environmentId === null
      ? EMPTY_PROVIDERS_ATOM
      : serverEnvironment.providersValueAtom(environmentId),
  );
  const family = useFamily();
  const familyKnown = family.profile.source === "engine";
  const onWelcome = route.name === "welcome";
  // Judged on the engine's first answer: a parent finishing the Family step mid-welcome must not
  // close it under them. (State adjusted while rendering, as React suggests for this.)
  const [familyAtStart, setFamilyAtStart] = useState<boolean | null>(null);
  if (familyAtStart === null && familyKnown) setFamilyAtStart(family.enabled);
  // `#/welcome` is decided once per visit, so the profile turning on inside it asks nothing.
  const [welcome, setWelcome] = useState<"unknown" | "open" | "closed">("unknown");
  if (!onWelcome && welcome !== "unknown") setWelcome("unknown");
  // A first run that has ended in this window stays closed even if the engine could not save it.
  const [ended, setEnded] = useState(false);
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
  const show = onWelcome
    ? welcome === "open"
    : !ended &&
      shouldShowOnboarding(
        route,
        providers,
        familyKnown ? family.profile.welcome : null,
        familyAtStart,
      );
  if (!show || environmentId === null) return <>{children}</>;
  return (
    <OnboardingSheet
      environmentId={environmentId}
      onClose={() => {
        setEnded(true);
        if (route.name === "welcome") navigate(HOME_HREF);
      }}
    />
  );
}
