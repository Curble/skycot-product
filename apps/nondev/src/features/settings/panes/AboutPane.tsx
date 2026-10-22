import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Globe, Scale, ScrollText } from "lucide-react";
import { useState } from "react";

import { APP_VERSION } from "~/branding";

// The MIT licence's one condition is that its text travels with every copy of
// the software, so the About pane bundles the repository's LICENSE verbatim.
import mitLicenseText from "../../../../../../LICENSE?raw";
import { ADVANCED_MODE_LABEL, COPYRIGHT_LINE, PRODUCT_NAME } from "../../../brand";
import { serverEnvironment } from "../../../state/server";
import { Mascot } from "../../brand/Mascot";
import { Button } from "../../../ui/Button";
import { ListRow } from "../../../ui/ListRow";
import { Sheet } from "../../../ui/Sheet";
import { StepBadge } from "../../../ui/StepBadge";
import { SettingsGroup } from "../SettingsGroup";
import { OpenSourceLicensesSheet } from "./OpenSourceLicensesSheet";

const UPSTREAM_NAME = "T3 Code";
const UPSTREAM_COPYRIGHT = "© T3 Tools Inc.";
const UPSTREAM_URL = "https://github.com/pingdotgg/t3code";
const WEBSITE_URL = "https://www.skycot.com";

function MitLicenseSheet({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      icon={Scale}
      iconTone="grey"
      wide
      title={`Based on ${UPSTREAM_NAME}`}
      description={
        <>
          {PRODUCT_NAME} is built on {UPSTREAM_NAME}, {UPSTREAM_COPYRIGHT}, released under the MIT
          licence. That licence lets anyone use, change and sell the software on one condition: this
          notice travels with every copy. It is reproduced here in full. {PRODUCT_NAME} is an
          independent product and is not affiliated with or endorsed by T3 Tools Inc.
        </>
      }
      actions={
        <>
          <Button onClick={() => window.open(UPSTREAM_URL, "_blank", "noopener,noreferrer")}>
            {UPSTREAM_NAME} source
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <pre
        style={{
          margin: 0,
          padding: "12px 14px",
          whiteSpace: "pre-wrap",
          fontFamily: "var(--fm-mono)",
          fontSize: "calc(12px * var(--fm-text-scale))",
          lineHeight: 1.55,
          maxHeight: "50vh",
          overflow: "auto",
          background: "var(--fm-bg-soft, rgba(0, 0, 0, 0.04))",
          borderRadius: 10,
        }}
      >
        {mitLicenseText}
      </pre>
    </Sheet>
  );
}

export function AboutPane({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  return (
    <>
      <div className="fm-about-hero">
        <Mascot pose="hello" size={88} />
        <span className="fm-about-hero__name">{PRODUCT_NAME}</span>
        <span className="fm-about-hero__line">
          Version {APP_VERSION}
          {config ? ` · engine ${config.environment.serverVersion}` : ""}
        </span>
      </div>
      <SettingsGroup title="Online" footer={`${COPYRIGHT_LINE}, Melbourne, Australia.`}>
        <ListRow
          leading={<StepBadge state="todo" icon={Globe} />}
          title="Website"
          subtitle={WEBSITE_URL.replace(/^https?:\/\//, "")}
          href={WEBSITE_URL}
          chevron
        />
      </SettingsGroup>
      <SettingsGroup
        title="Credits"
        footer={`${PRODUCT_NAME} is a plain-language interface built on ${UPSTREAM_NAME}, an open-source project by T3 Tools Inc. The engine, the provider connectors and the developer interface (${ADVANCED_MODE_LABEL}) are ${UPSTREAM_NAME}'s. "T3" and "${UPSTREAM_NAME}" are names of T3 Tools Inc.; ${PRODUCT_NAME} is not affiliated with or endorsed by them.`}
      >
        <ListRow
          leading={<StepBadge state="todo" icon={Scale} />}
          title={`Based on ${UPSTREAM_NAME}`}
          subtitle={`${UPSTREAM_COPYRIGHT} · MIT licence · read the full text`}
          onClick={() => setLicenseOpen(true)}
          chevron
        />
        <ListRow
          leading={<StepBadge state="todo" icon={ScrollText} />}
          title="Open-source licences"
          subtitle="Every library this app is built from, with its licence."
          onClick={() => setNoticesOpen(true)}
          chevron
        />
      </SettingsGroup>
      <MitLicenseSheet open={licenseOpen} onClose={() => setLicenseOpen(false)} />
      <OpenSourceLicensesSheet open={noticesOpen} onClose={() => setNoticesOpen(false)} />
    </>
  );
}
