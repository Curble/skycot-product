// Settings › Family › "AI assistants for children": every assistant SKYCOT can drive, with what
// the Family profile does with it. Codex and Claude: locked down. Any other: allowed by a
// grown-up (after the allow sheet and the parent code), or not allowed. Stopping needs no code,
// because it only makes the profile stricter; the engine refuses that assistant's next turn.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { assistantAgeTerms, assistantTitle } from "@t3tools/skycot-rules/assistants";
import { useEffect, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { ListRow } from "../../ui/ListRow";
import { Pill, type PillTone } from "../../ui/Pill";
import { catalogEntryFor, PROVIDER_CATALOG } from "../settings/providerCatalog";
import { ProviderBadge } from "../settings/ProviderRows";
import { SettingsGroup } from "../settings/SettingsGroup";
import { AllowAssistantSheet } from "./AllowAssistantSheet";
import {
  ASSISTANT_STATE_LABEL,
  assistantFamilyState,
  assistantStateLine,
  familyAssistantOrder,
  type AssistantFamilyState,
} from "./assistantAllowance";
import { useFamily } from "./FamilyProvider";
import { refreshFamily, stopAllowingAssistant } from "./store";

/** The assistant's name; one SKYCOT has no name for shows the engine's own label for it. */
function rowTitle(driver: string): string {
  const title = assistantTitle(driver);
  return title === "This assistant" ? catalogEntryFor(driver).brand : title;
}

const STATE_TONE: Readonly<Record<AssistantFamilyState, PillTone>> = {
  "locked-down": "ok",
  allowed: "waiting",
  "not-allowed": "neutral",
};

export function FamilyAssistantsGroup({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const { profile } = useFamily();
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const [allowing, setAllowing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The list may have changed from another device or tab: ask the engine when it opens.
  useEffect(() => {
    void refreshFamily();
  }, []);
  const drivers = familyAssistantOrder([
    ...PROVIDER_CATALOG.map((entry) => entry.driver),
    ...(providers ?? []).map((provider) => String(provider.driver)),
    // An allowance for an assistant this Mac no longer has can still be taken back.
    ...profile.allowedAssistants,
  ]);

  const stop = async (driver: string) => {
    setProblem(null);
    const result = await stopAllowingAssistant(driver);
    if (!result.ok) setProblem(result.message);
  };

  return (
    <>
      <SettingsGroup
        title="AI helpers for children"
        footer="SKYCOT switches off Codex's and Claude's own add-ons for a child. Any other AI starts only once a grown-up allows it with the parent code; its own add-ons stay on. Stopping needs no code."
      >
        {drivers.map((driver) => {
          const state = assistantFamilyState(driver, profile.allowedAssistants);
          return (
            <ListRow
              key={driver}
              leading={<ProviderBadge driver={driver} />}
              title={
                <span className="fm-family-assistant__title">
                  {rowTitle(driver)}
                  <Pill tone={STATE_TONE[state]} size="sm">
                    {ASSISTANT_STATE_LABEL[state]}
                  </Pill>
                </span>
              }
              subtitle={`${assistantStateLine(state)} ${assistantAgeTerms(driver).sentence}`}
              trailing={
                state === "not-allowed" ? (
                  <Button size="sm" onClick={() => setAllowing(driver)}>
                    Allow…
                  </Button>
                ) : state === "allowed" ? (
                  <Button size="sm" onClick={() => void stop(driver)}>
                    Stop allowing
                  </Button>
                ) : undefined
              }
            />
          );
        })}
      </SettingsGroup>
      {problem ? <Banner tone="warning">{problem}</Banner> : null}
      {allowing !== null ? (
        <AllowAssistantSheet driver={allowing} onClose={() => setAllowing(null)} />
      ) : null}
    </>
  );
}
