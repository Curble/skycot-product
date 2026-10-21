// Plain-language facts about each AI provider the engine can drive, keyed by
// the engine's driver slug. Status logic is the stock UI's (apps/web/src/
// onboarding/providerReadiness.logic.ts) so both clients agree on "ready".
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";

import { getOnboardingProviderState } from "~/onboarding/providerReadiness.logic";

export type ProviderReadiness = ReturnType<typeof getOnboardingProviderState>;

/** How the app can get this provider working without a terminal. */
export type ProviderFlow =
  /** The engine installs and signs in for us (Codex "Connect with ChatGPT", Antigravity + Google). */
  | "managed"
  /** The engine can sign in but not install; the CLI must already be on the Mac. */
  | "sign-in-only"
  /** The engine offers no in-app sign-in; we show the two commands to run in Terminal. */
  | "instructions";

export interface ProviderCatalogEntry {
  readonly driver: string;
  /** "ChatGPT", "Google", "Claude": what the person pays for, not the CLI's name. */
  readonly brand: string;
  /** "Codex, from OpenAI": the thing that actually runs. */
  readonly runs: string;
  readonly summary: string;
  /** Shown as the primary choice in onboarding. */
  readonly primary: boolean;
}

export const PROVIDER_CATALOG: ReadonlyArray<ProviderCatalogEntry> = [
  {
    driver: "codex",
    brand: "ChatGPT",
    runs: "Codex, from OpenAI",
    summary: "Uses your ChatGPT Plus or Pro plan. Sign in with your ChatGPT account.",
    primary: true,
  },
  {
    driver: "antigravity",
    brand: "Google",
    runs: "Antigravity, from Google",
    summary: "Uses your Google account. Installed and signed in for you.",
    primary: true,
  },
  {
    driver: "claudeAgent",
    brand: "Claude",
    runs: "Claude Code, from Anthropic",
    summary: "Uses your Claude Pro or Max plan. Two short commands in Terminal, once.",
    primary: true,
  },
  { driver: "cursor", brand: "Cursor", runs: "Cursor's agent", summary: "", primary: false },
  { driver: "grok", brand: "Grok", runs: "Grok, from xAI", summary: "", primary: false },
  { driver: "opencode", brand: "OpenCode", runs: "OpenCode", summary: "", primary: false },
  { driver: "pi", brand: "Pi", runs: "Pi", summary: "", primary: false },
  { driver: "muse", brand: "Muse", runs: "Muse", summary: "", primary: false },
];

export function catalogEntryFor(driver: string): ProviderCatalogEntry {
  return (
    PROVIDER_CATALOG.find((entry) => entry.driver === driver) ?? {
      driver,
      brand: driver.charAt(0).toUpperCase() + driver.slice(1),
      runs: driver,
      summary: "",
      primary: false,
    }
  );
}

export function providerInstanceIdFor(driver: string) {
  return defaultInstanceIdForDriver(ProviderDriverKind.make(driver));
}

/** The engine's snapshot for a driver, preferring the instance closest to ready. */
export function providerForDriver(
  providers: ReadonlyArray<ServerProvider> | null,
  driver: string,
): ServerProvider | undefined {
  const order: Record<ProviderReadiness, number> = {
    checking: 0,
    disabled: 1,
    install: 2,
    attention: 3,
    signIn: 4,
    ready: 5,
  };
  let best: ServerProvider | undefined;
  for (const provider of providers ?? []) {
    if (provider.driver !== driver) continue;
    if (!best || order[readiness(provider)] > order[readiness(best)]) best = provider;
  }
  return best;
}

export function readiness(provider: ServerProvider | undefined): ProviderReadiness {
  return getOnboardingProviderState(provider);
}

export function isProviderReady(provider: ServerProvider | undefined): boolean {
  return readiness(provider) === "ready";
}

export function anyProviderReady(providers: ReadonlyArray<ServerProvider> | null): boolean {
  return (providers ?? []).some(isProviderReady);
}

export function flowFor(provider: ServerProvider | undefined, driver: string): ProviderFlow {
  // Codex is managed even before the engine has a snapshot for it: the managed
  // driver appears once setupMode is switched, which the connect hook does.
  if (driver === "codex") return "managed";
  if (provider?.setup?.canAuthenticate && provider.setup.canInstall) return "managed";
  if (provider?.setup?.canAuthenticate) return "sign-in-only";
  return "instructions";
}

/** One plain sentence for a provider row's subtitle. */
export function statusSentence(provider: ServerProvider | undefined): string {
  switch (readiness(provider)) {
    case "checking":
      return "Checking…";
    case "disabled":
      return "Switched off in Advanced mode.";
    case "install":
      return "Not on this Mac yet.";
    case "signIn":
      return "Installed. Needs you to sign in.";
    case "attention":
      return provider?.message ?? "Installed, but something needs a look.";
    case "ready": {
      const email = provider?.auth.email?.trim();
      return email ? `Signed in as ${email}.` : "Signed in and ready.";
    }
  }
}
