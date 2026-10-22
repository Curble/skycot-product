import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronLeft, Laptop } from "lucide-react";

import { useColumns } from "../../app/useColumns";
import {
  HOME_HREF,
  SETTINGS_HREF,
  navigate,
  settingsHref,
  type SettingsSection,
} from "../../router";
import { enabledEnvironmentIdsAtom } from "../../state/catalog";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { ListRow, List } from "../../ui/ListRow";
import { useFamily } from "../family/FamilyProvider";
import { familyCopy } from "../family/copy";
import { RecapScreen } from "../recap/RecapScreen";
import { AboutPane } from "./panes/AboutPane";
import { AdvancedPane } from "./panes/AdvancedPane";
import { AiAssistantsPane } from "./panes/AiAssistantsPane";
import { AppearancePane } from "./panes/AppearancePane";
import { AutonomyPane } from "./panes/AutonomyPane";
import { FamilyPane } from "./panes/FamilyPane";
import { NotificationsPane } from "./panes/NotificationsPane";
import { PrivacyPane } from "./panes/PrivacyPane";
import { SharingPane } from "./panes/SharingPane";
import { VoicePane } from "./panes/VoicePane";
import { YourMacPane } from "./panes/YourMacPane";
import { SECTIONS } from "./sections";

export { SECTIONS } from "./sections";

/**
 * System Settings: a section list on the left, one calm pane on the right.
 * The window title is derived from the route in AppShell, not set here, so
 * leaving Settings never leaves a stale title behind.
 */
export function SettingsScreen({
  section,
  recapChildId = null,
}: {
  readonly section: SettingsSection | null;
  /** Settings › Family › "<child>'s week". */
  readonly recapChildId?: string | null;
}) {
  const columns = useColumns();
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const environmentId = environmentIds[0] ?? null;
  const family = useFamily();
  // The Family profile hides the developer-tools section; Settings › Family keeps the one way in.
  const sections = family.enabled ? SECTIONS.filter((entry) => entry.id !== "advanced") : SECTIONS;
  const active: SettingsSection | null = section ?? (columns === 1 ? null : "assistants");
  const meta = sections.find((entry) => entry.id === active) ?? null;

  // The only way out of Settings used to be the browser's Back button.
  const done = (
    <Button variant="primary" size="sm" onClick={() => navigate(HOME_HREF)}>
      Done
    </Button>
  );

  const nav = (
    <nav className="fm-settings__nav" aria-label="Settings sections">
      <List plain label="Settings sections">
        {sections.map((entry) => (
          <ListRow
            key={entry.id}
            leading={
              <span className={`fm-settings__glyph fm-settings__glyph--${entry.tone}`} aria-hidden>
                <entry.icon size={15} strokeWidth={1.9} />
              </span>
            }
            title={entry.label}
            subtitle={columns === 1 ? entry.summary : undefined}
            selected={entry.id === active}
            href={settingsHref(entry.id)}
            chevron={columns === 1}
          />
        ))}
      </List>
    </nav>
  );

  const hiddenAdvanced = family.enabled && active === "advanced";
  const detail =
    recapChildId !== null ? (
      <RecapScreen childId={recapChildId} environmentId={environmentId} />
    ) : hiddenAdvanced ? (
      <section className="fm-settings__detail" aria-labelledby="fm-settings-title">
        <header className="fm-settings__header">
          <h2 id="fm-settings-title" className="fm-settings__title">
            Family
          </h2>
          <span className="fm-settings__header-spacer" />
          {done}
        </header>
        <div className="fm-settings__panes">
          <EmptyState icon={Laptop} title={`Hidden by the ${familyCopy.title}`}>
            A parent can open the developer tools from Settings › Family with the parent code.
          </EmptyState>
        </div>
      </section>
    ) : meta ? (
      <section className="fm-settings__detail" aria-labelledby="fm-settings-title">
        <header className="fm-settings__header">
          {columns === 1 ? (
            <Button
              variant="plain"
              size="sm"
              icon={ChevronLeft}
              onClick={() => (window.location.hash = SETTINGS_HREF)}
            >
              Settings
            </Button>
          ) : null}
          <h2 id="fm-settings-title" className="fm-settings__title">
            {meta.label}
          </h2>
          <span className="fm-settings__header-spacer" />
          {done}
        </header>
        <div className="fm-settings__panes">
          {environmentId === null ? (
            <EmptyState icon={Laptop} title="Connecting to your Mac…">
              Settings appear as soon as the connection is up.
            </EmptyState>
          ) : (
            <Pane section={meta.id} environmentId={environmentId} />
          )}
        </div>
      </section>
    ) : null;

  // The nav and the detail keep their child positions at every width, so a
  // window dragged across the one-column breakpoint re-lays the pane out
  // instead of remounting it: an open sheet or a half-typed form survives.
  return (
    <div className={`fm-settings${columns === 1 ? " fm-settings--stack" : ""}`}>
      {columns === 1 && active === null ? (
        <header className="fm-settings__header">
          <h2 className="fm-settings__title">Settings</h2>
          <span className="fm-settings__header-spacer" />
          {done}
        </header>
      ) : null}
      {columns === 1 && active !== null ? null : nav}
      {detail}
    </div>
  );
}

function Pane({
  section,
  environmentId,
}: {
  readonly section: SettingsSection;
  readonly environmentId: EnvironmentId;
}) {
  switch (section) {
    case "assistants":
      return <AiAssistantsPane environmentId={environmentId} />;
    case "autonomy":
      return <AutonomyPane environmentId={environmentId} />;
    case "notifications":
      return <NotificationsPane />;
    case "family":
      return <FamilyPane environmentId={environmentId} />;
    case "sharing":
      return <SharingPane environmentId={environmentId} />;
    case "mac":
      return <YourMacPane environmentId={environmentId} />;
    case "appearance":
      return <AppearancePane />;
    case "voice":
      return <VoicePane />;
    case "privacy":
      return <PrivacyPane environmentId={environmentId} />;
    case "advanced":
      return <AdvancedPane />;
    case "about":
      return <AboutPane environmentId={environmentId} />;
  }
}
