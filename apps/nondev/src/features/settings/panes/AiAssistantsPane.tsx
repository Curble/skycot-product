import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import { ADVANCED_MODE_LABEL } from "../../../brand";
import { WELCOME_HREF, navigate } from "../../../router";
import { familyAgeTermsNote } from "../../family/assistantAllowance";
import { useFamily } from "../../family/FamilyProvider";
import { UsageSettingsGroup } from "../../usage/UsageSettings";
import { providerForSelection, resolveDefaultModelSelection } from "../../../state/providers";
import { serverEnvironment } from "../../../state/server";
import { Button } from "../../../ui/Button";
import { ListRow } from "../../../ui/ListRow";
import { Pill } from "../../../ui/Pill";
import { PROVIDER_CATALOG, catalogEntryFor, providerForDriver } from "../providerCatalog";
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
  const family = useFamily();

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
  // One name everywhere: the brand the person pays for, as the rows above say it.
  const defaultEntry = defaultProvider ? catalogEntryFor(String(defaultProvider.driver)) : null;

  return (
    <>
      <SettingsGroup
        title="Which AI do you pay for?"
        footer={
          family.enabled
            ? `Green means ready. Signing in happens on the provider's own website; SKYCOT never sees your password. ${familyAgeTermsNote()}`
            : "Green means ready. Signing in happens on the provider's own website; SKYCOT never sees your password."
        }
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
          defaultEntry
            ? `New conversations start with ${defaultEntry.brand}, the first assistant that is ready. Pick a different one for a single conversation in ${ADVANCED_MODE_LABEL}.`
            : "Once an assistant is ready it will be used for new conversations."
        }
      >
        {defaultProvider && defaultEntry ? (
          <ListRow
            leading={<ProviderBadge driver={String(defaultProvider.driver)} />}
            title={defaultEntry.brand}
            subtitle={`${defaultEntry.runs}. Ready.`}
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

      <UsageSettingsGroup environmentId={environmentId} />

      <SettingsGroup title="More">
        <ListRow
          title="Other assistants"
          subtitle="Cursor, Grok, OpenCode and others. Most need a developer to set up."
          trailing={
            moreOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />
          }
          expanded={moreOpen}
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
          subtitle={`The short first-run guide: who it's for, assistant, folder, autonomy, look.${family.enabled ? " Asks for the parent code." : ""}`}
          // The welcome route asks for the code itself, so a typed address asks too.
          onClick={() => navigate(WELCOME_HREF)}
          chevron
        />
      </SettingsGroup>
    </>
  );
}
