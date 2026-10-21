import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import { ADVANCED_MODE_LABEL } from "../../../brand";
import { WELCOME_HREF } from "../../../router";
import {
  providerDisplayName,
  providerForSelection,
  resolveDefaultModelSelection,
} from "../../../state/providers";
import { serverEnvironment } from "../../../state/server";
import { Button } from "../../../ui/Button";
import { ListRow } from "../../../ui/ListRow";
import { Pill } from "../../../ui/Pill";
import { PROVIDER_CATALOG, providerForDriver } from "../providerCatalog";
import { ProviderBadge, ProviderRow } from "../ProviderRows";
import { SettingsGroup } from "../SettingsGroup";

export function AiAssistantsPane({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const refresh = useAtomCommand(serverEnvironment.refreshProviders, { reportFailure: false });
  const [moreOpen, setMoreOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const os = config?.environment.platform.os ?? "darwin";

  // Status can be stale while a sign-in happened in Terminal; probe on arrival.
  useEffect(() => {
    void refresh({ environmentId, input: {} });
  }, [environmentId, refresh]);

  const primary = PROVIDER_CATALOG.filter((entry) => entry.primary);
  const others = PROVIDER_CATALOG.filter((entry) => !entry.primary);
  const extraDrivers = new Set(
    (providers ?? [])
      .map((provider) => String(provider.driver))
      .filter((driver) => !PROVIDER_CATALOG.some((entry) => entry.driver === driver)),
  );
  const defaultProvider = providerForSelection(
    providers,
    resolveDefaultModelSelection(providers, null),
  );

  return (
    <>
      <SettingsGroup
        title="Which AI do you pay for?"
        footer="Green means ready. Signing in happens on the provider's own website; SKYCOT never sees your password."
      >
        {primary.map((entry) => (
          <ProviderRow
            key={entry.driver}
            environmentId={environmentId}
            driver={entry.driver}
            provider={providerForDriver(providers, entry.driver)}
            settings={settings}
            os={os}
            showSignOut
          />
        ))}
      </SettingsGroup>

      <SettingsGroup
        title="Used by default"
        footer={
          defaultProvider
            ? `New conversations start with ${providerDisplayName(defaultProvider)}, the first assistant that is ready. Pick a different one for a single conversation in ${ADVANCED_MODE_LABEL}.`
            : "Once an assistant is ready it will be used for new conversations."
        }
      >
        {defaultProvider ? (
          <ListRow
            leading={<ProviderBadge driver={String(defaultProvider.driver)} />}
            title={providerDisplayName(defaultProvider)}
            subtitle={
              defaultProvider.models.find((model) => model.isDefault)?.name ??
              defaultProvider.models[0]?.name ??
              "Ready"
            }
            trailing={
              <Pill tone="provider" size="sm">
                Default
              </Pill>
            }
          />
        ) : (
          <ListRow title="No assistant is ready yet" subtitle="Connect one above to get started." />
        )}
      </SettingsGroup>

      <SettingsGroup title="More">
        <ListRow
          title="Other assistants"
          subtitle="Cursor, Grok, OpenCode and others. Most need a developer to set up."
          trailing={
            moreOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />
          }
          onClick={() => setMoreOpen((value) => !value)}
        />
        {moreOpen
          ? [...others.map((entry) => entry.driver), ...extraDrivers].map((driver) => (
              <ProviderRow
                key={driver}
                environmentId={environmentId}
                driver={driver}
                provider={providerForDriver(providers, driver)}
                settings={settings}
                os={os}
                showSignOut
              />
            ))
          : null}
        <ListRow
          title="Check again"
          subtitle="Ask your Mac which assistants are installed and signed in right now."
          trailing={
            <Button
              size="sm"
              icon={RefreshCw}
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true);
                void refresh({ environmentId, input: {} }).finally(() => setRefreshing(false));
              }}
            >
              {refreshing ? "Checking…" : "Check now"}
            </Button>
          }
        />
        <ListRow
          title="Run the welcome steps again"
          subtitle="The short first-run guide: assistant, folder, autonomy."
          href={WELCOME_HREF}
          chevron
        />
      </SettingsGroup>
    </>
  );
}
