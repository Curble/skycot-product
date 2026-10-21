import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Hammer, Scale } from "lucide-react";

import { APP_VERSION } from "~/branding";

import { advancedModeUrl } from "../../../app/platform";
import { PRODUCT_NAME } from "../../../brand";
import { serverEnvironment } from "../../../state/server";
import { Button } from "../../../ui/Button";
import { ListRow } from "../../../ui/ListRow";
import { StepBadge } from "../../../ui/StepBadge";
import { SettingsGroup } from "../SettingsGroup";

export function AboutPane({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  return (
    <>
      <SettingsGroup title={PRODUCT_NAME}>
        <ListRow
          leading={<StepBadge state="now" icon={Hammer} />}
          title={PRODUCT_NAME}
          subtitle={`Version ${APP_VERSION}${config ? ` · engine ${config.environment.serverVersion}` : ""}`}
        />
      </SettingsGroup>
      <SettingsGroup
        title="Credits"
        footer={`${PRODUCT_NAME} is a plain-language interface built on T3 Code. The engine, the provider connectors and the developer interface are T3 Code's.`}
      >
        <ListRow title="Based on T3 Code" subtitle="MIT licence · © T3 Tools Inc." />
        <ListRow
          leading={<StepBadge state="todo" icon={Scale} />}
          title="Open-source licences"
          subtitle="Every library this app is built from, with its licence."
          trailing={
            <Button
              size="sm"
              onClick={() =>
                window.location.assign(`${advancedModeUrl()}settings/open-source-licenses`)
              }
            >
              View
            </Button>
          }
        />
      </SettingsGroup>
    </>
  );
}
