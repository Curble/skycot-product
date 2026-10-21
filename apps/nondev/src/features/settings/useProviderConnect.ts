import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  ProviderDriverKind,
  type EnvironmentId,
  type ProviderAuthState,
  type ProviderInstallState,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import { serverEnvironment } from "../../state/server";
import { flowFor, providerInstanceIdFor, readiness } from "./providerCatalog";

export type ConnectStatus =
  | "idle"
  | "preparing"
  | "installing"
  | "waiting"
  | "finishing"
  | "failed"
  | "unsupported";

export interface ProviderConnect {
  readonly status: ConnectStatus;
  readonly busy: boolean;
  /** Plain sentence for the row while something is happening. */
  readonly message: string | null;
  /** The sign-in page, while the engine waits for the browser to come back. */
  readonly signInUrl: string | null;
  /** A code to type on the sign-in page, for providers that use one. */
  readonly deviceCode: string | null;
  readonly installProgress: string | null;
  readonly canSignOut: boolean;
  connect(): Promise<void>;
  /** Re-enable a provider a developer switched off, so the row can be connected. */
  enable(): Promise<void>;
  openSignIn(): Promise<void>;
  cancel(): Promise<void>;
  signOut(): Promise<boolean>;
}

const openExternal = async (url: string) => {
  if (window.desktopBridge) {
    const opened = await window.desktopBridge.openExternal(url);
    if (!opened) throw new Error("Unable to open link.");
    return;
  }
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (popup === null) throw new Error("Popup blocked.");
};

function valueOf<A>(result: AsyncResult.AsyncResult<A, unknown>): A | null {
  return Option.getOrNull(AsyncResult.value(result));
}

/**
 * Drives one provider from "not on this Mac" to "signed in" through the
 * engine's install and auth RPCs, the same calls the stock Settings makes
 * (apps/web/src/components/settings/CodexSetupSection.tsx and
 * ProviderAuthenticationSection.tsx) minus remote hand-off and in-app
 * terminals. Codex is forced into the engine's managed mode first so the
 * engine downloads it and runs the ChatGPT sign-in itself.
 */
export function useProviderConnect(
  environmentId: EnvironmentId,
  driver: string,
  provider: ServerProvider | undefined,
): ProviderConnect {
  const instanceId = provider?.instanceId ?? providerInstanceIdFor(driver);
  const target = { environmentId, input: { instanceId } };
  const auth = valueOf<ProviderAuthState>(
    useAtomValue(serverEnvironment.providerAuthState(target)),
  );
  const install = valueOf<ProviderInstallState>(
    useAtomValue(serverEnvironment.providerInstallState(target)),
  );
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const options = { reportFailure: false, reportDefect: false };
  const startAuth = useAtomCommand(serverEnvironment.startProviderAuth, options);
  const respondAuth = useAtomCommand(serverEnvironment.respondProviderAuth, options);
  const completeAuth = useAtomCommand(serverEnvironment.completeProviderAuth, options);
  const cancelAuth = useAtomCommand(serverEnvironment.cancelProviderAuth, options);
  const logoutAuth = useAtomCommand(serverEnvironment.logoutProviderAuth, options);
  const startInstall = useAtomCommand(serverEnvironment.startProviderInstall, options);
  const cancelInstall = useAtomCommand(serverEnvironment.cancelProviderInstall, options);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, options);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, options);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaiting, setAwaiting] = useState(false);
  const pendingRef = useRef(false);
  const signInAfterInstall = useRef(false);
  const openedFlow = useRef<string | null>(null);
  const openRequested = useRef(false);

  const flow = flowFor(provider, driver);
  const managed = flow === "managed";
  const installed =
    provider?.installed === true || (install !== null && install.installedVersion != null);
  const authenticated = provider?.auth.status === "authenticated";
  const interaction = auth?.interaction ?? null;
  const url =
    interaction?.type === "browser" || interaction?.type === "deviceCode"
      ? interaction.url
      : (auth?.authorizationUrl ?? null);
  const flowId = auth?.flowId ?? null;
  const installActive =
    install?.phase === "downloading" ||
    install?.phase === "extracting" ||
    install?.phase === "verifying";
  const authActive =
    auth?.phase === "starting" || auth?.phase === "waiting" || auth?.phase === "verifying";
  const finishing = awaiting && !authenticated && auth?.phase === "succeeded";

  // Settle "awaiting" once the engine reports the account, or the flow ended badly.
  if (awaiting && (authenticated || auth?.phase === "failed" || auth?.phase === "cancelled")) {
    setAwaiting(false);
  }

  const run = async (request: () => Promise<AtomCommandResult<unknown, unknown>>) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    let ok = false;
    try {
      const result = await request();
      if (result._tag === "Success") ok = true;
      else if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? calm(failure.message) : "That didn't work. Try again.");
      }
    } catch {
      setError("That didn't work. Try again.");
    }
    pendingRef.current = false;
    setPending(false);
    return ok;
  };

  const clientCallback = window.desktopBridge?.receiveProviderAuthCallback !== undefined;

  const signIn = async () => {
    openRequested.current = true;
    const ok = await run(() =>
      startAuth({
        environmentId,
        input: {
          instanceId,
          ...(driver === "codex" ? { methodId: "chatgpt" } : {}),
          returnUrl: window.location.href,
          callbackMode: clientCallback ? "client" : "server",
        },
      }),
    );
    if (ok) setAwaiting(true);
    else openRequested.current = false;
  };

  const ensureManagedCodex = async () => {
    if (driver !== "codex" || settings === null) return true;
    const current = settings.providerInstances[instanceId];
    const config =
      current?.config !== null && typeof current?.config === "object"
        ? (current.config as Record<string, unknown>)
        : {};
    if (config.setupMode === "managed" && current?.enabled !== false) return true;
    const ok = await run(() =>
      updateSettings({
        environmentId,
        input: {
          patch: {
            providerInstances: {
              ...settings.providerInstances,
              [instanceId]: {
                driver: ProviderDriverKind.make("codex"),
                ...(current?.displayName ? { displayName: current.displayName } : {}),
                enabled: true,
                config: { ...config, enabled: true, setupMode: "managed" },
              },
            },
          },
        },
      }),
    );
    if (ok) await refreshProviders({ environmentId, input: { instanceId } });
    return ok;
  };

  const enable = async () => {
    if (settings === null || !provider) return;
    const current = settings.providerInstances[instanceId];
    const ok = await run(() =>
      updateSettings({
        environmentId,
        input: {
          patch: {
            providerInstances: {
              ...settings.providerInstances,
              [instanceId]: {
                ...(current ?? { driver: provider.driver }),
                driver: provider.driver,
                enabled: true,
              },
            },
          },
        },
      }),
    );
    if (ok) await refreshProviders({ environmentId, input: { instanceId } });
  };

  const connect = async () => {
    if (pendingRef.current || installActive || authActive) return;
    if (flow === "instructions") return;
    if (!(await ensureManagedCodex())) return;
    if (!installed && managed) {
      signInAfterInstall.current = true;
      if (!(await run(() => startInstall({ environmentId, input: { instanceId } })))) {
        signInAfterInstall.current = false;
      }
      return;
    }
    await signIn();
  };

  // Chain: install finished → sign in.
  const signInAfterInstallEvent = useEffectEvent(() => {
    void signIn();
  });
  useEffect(() => {
    if (!signInAfterInstall.current || pending || installActive) return;
    if (install?.phase === "failed" || install?.phase === "cancelled") {
      signInAfterInstall.current = false;
      return;
    }
    if (install?.phase === "succeeded" || installed) {
      signInAfterInstall.current = false;
      // oxlint-disable-next-line react/set-state-in-effect -- Starting sign-in dispatches a server command, which marks itself pending before it awaits.
      signInAfterInstallEvent();
    }
  }, [pending, installActive, install?.phase, installed]);

  const openSignIn = async () => {
    if (!url) return;
    try {
      if (interaction?.type === "browser" && interaction.requiresConsent && flowId) {
        const accepted = await run(() =>
          respondAuth({
            environmentId,
            input: {
              instanceId,
              flowId,
              interactionId: interaction.id,
              response: { type: "browser", action: "accept" },
            },
          }),
        );
        if (!accepted) return;
      }
      const receive = window.desktopBridge?.receiveProviderAuthCallback;
      if (receive && clientCallback && flowId) {
        const callbackUrl = await receive(url);
        await run(() =>
          completeAuth({ environmentId, input: { instanceId, flowId, callbackUrl } }),
        );
      } else {
        await openExternal(url);
      }
      setError(null);
    } catch {
      setError("Your browser didn't open. Use the button to open the sign-in page.");
    }
  };

  // Open the sign-in page once per flow as soon as the engine hands us a URL.
  const unsupportedInteraction =
    interaction?.type === "terminal" || interaction?.type === "credentials";
  const openSignInEvent = useEffectEvent(() => {
    void openSignIn();
  });
  useEffect(() => {
    if (!openRequested.current || auth?.phase !== "waiting" || !flowId || !url) return;
    if (openedFlow.current === flowId || unsupportedInteraction) return;
    openedFlow.current = flowId;
    openRequested.current = false;
    openSignInEvent();
  }, [auth?.phase, flowId, url, unsupportedInteraction]);

  // The engine's provider snapshot lags the auth flow; ask for a fresh one.
  useEffect(() => {
    if (awaiting && auth?.phase === "succeeded") {
      void refreshProviders({ environmentId, input: { instanceId } });
    }
  }, [awaiting, auth?.phase, refreshProviders, environmentId, instanceId]);

  const cancel = async () => {
    setAwaiting(false);
    signInAfterInstall.current = false;
    openRequested.current = false;
    if (installActive && install?.operationId) {
      await run(() =>
        cancelInstall({ environmentId, input: { instanceId, operationId: install.operationId! } }),
      );
    }
    if (authActive && flowId) {
      await run(() => cancelAuth({ environmentId, input: { instanceId, flowId } }));
    }
  };

  const signOut = async () => {
    const ok = await run(() => logoutAuth({ environmentId, input: { instanceId } }));
    if (ok) await refreshProviders({ environmentId, input: { instanceId } });
    return ok;
  };

  let status: ConnectStatus = "idle";
  if (flow === "instructions") status = "unsupported";
  else if (unsupportedInteraction && authActive) status = "unsupported";
  else if (installActive) status = "installing";
  else if (finishing || auth?.phase === "verifying") status = "finishing";
  else if (authActive || (awaiting && !authenticated && (auth === null || auth.phase === "idle")))
    status = "waiting";
  else if (pending) status = "preparing";
  else if (error !== null || (awaiting && auth?.phase === "failed")) status = "failed";

  const installProgress =
    install?.phase === "downloading"
      ? `Downloading… ${(install.downloadedBytes / 1_000_000).toFixed(0)}${
          install.totalBytes === null ? "" : ` of ${(install.totalBytes / 1_000_000).toFixed(0)}`
        } MB`
      : install?.phase === "extracting"
        ? "Installing…"
        : install?.phase === "verifying"
          ? "Checking the install…"
          : null;

  const message =
    error ??
    (status === "unsupported" && unsupportedInteraction
      ? "This sign-in needs a terminal. Finish it in Advanced mode."
      : status === "installing"
        ? installProgress
        : status === "finishing"
          ? "Finishing sign-in…"
          : status === "waiting"
            ? interaction?.type === "deviceCode"
              ? "Enter the code on the page that opened."
              : "Finish signing in in your browser, then come back here."
            : status === "preparing"
              ? "Getting ready…"
              : auth?.phase === "failed" && awaiting
                ? calm(auth.message ?? "Sign-in didn't finish.")
                : null);

  return {
    status,
    busy: pending || installActive || authActive || finishing,
    message,
    signInUrl: status === "waiting" ? url : null,
    deviceCode:
      interaction?.type === "deviceCode" && status === "waiting" ? interaction.userCode : null,
    installProgress,
    canSignOut:
      authenticated && readiness(provider) !== "disabled" && provider?.auth.canLogout !== false,
    connect,
    enable,
    openSignIn,
    cancel,
    signOut,
  };
}

/** Engine failure text is developer-grade; keep the sentence, drop codes and stack-like noise. */
function calm(detail: string): string {
  const first = detail.split("\n")[0]?.trim() ?? "";
  if (first.length === 0 || /^\w*Error\b/.test(first)) return "That didn't work. Try again.";
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
}
