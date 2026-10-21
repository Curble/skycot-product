import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  Bot,
  ChevronLeft,
  Info,
  Laptop,
  Lock,
  type LucideIcon,
  Share2,
  ShieldCheck,
  SunMoon,
  Wrench,
} from "lucide-react";
import { useEffect } from "react";

import { useColumns } from "../../app/useColumns";
import { ADVANCED_MODE_LABEL, documentTitle } from "../../brand";
import { SETTINGS_HREF, settingsHref, type SettingsSection } from "../../router";
import { enabledEnvironmentIdsAtom } from "../../state/catalog";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { ListRow, List } from "../../ui/ListRow";
import { AboutPane } from "./panes/AboutPane";
import { AdvancedPane } from "./panes/AdvancedPane";
import { AiAssistantsPane } from "./panes/AiAssistantsPane";
import { AppearancePane } from "./panes/AppearancePane";
import { AutonomyPane } from "./panes/AutonomyPane";
import { PrivacyPane } from "./panes/PrivacyPane";
import { SharingPane } from "./panes/SharingPane";
import { YourMacPane } from "./panes/YourMacPane";

interface SectionMeta {
  readonly id: SettingsSection;
  readonly label: string;
  readonly summary: string;
  readonly icon: LucideIcon;
  readonly tone: "blue" | "green" | "orange" | "grey" | "red" | "purple";
}

export const SECTIONS: ReadonlyArray<SectionMeta> = [
  {
    id: "assistants",
    label: "AI assistants",
    summary: "ChatGPT, Google, Claude",
    icon: Bot,
    tone: "blue",
  },
  {
    id: "autonomy",
    label: "Autonomy & safety",
    summary: "How much it does alone",
    icon: ShieldCheck,
    tone: "green",
  },
  {
    id: "sharing",
    label: "Sharing & review",
    summary: "GitHub and reviewers",
    icon: Share2,
    tone: "purple",
  },
  {
    id: "mac",
    label: "Your Mac",
    summary: "This computer, remote access",
    icon: Laptop,
    tone: "grey",
  },
  {
    id: "appearance",
    label: "Appearance",
    summary: "Theme, light, dark",
    icon: SunMoon,
    tone: "orange",
  },
  { id: "privacy", label: "Privacy", summary: "What leaves this Mac", icon: Lock, tone: "green" },
  {
    id: "advanced",
    label: ADVANCED_MODE_LABEL,
    summary: "Developer interface",
    icon: Wrench,
    tone: "grey",
  },
  { id: "about", label: "About", summary: "Version and credits", icon: Info, tone: "blue" },
];

/** System Settings: a section list on the left, one calm pane on the right. */
export function SettingsScreen({ section }: { readonly section: SettingsSection | null }) {
  const columns = useColumns();
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const environmentId = environmentIds[0] ?? null;
  const active: SettingsSection | null = section ?? (columns === 1 ? null : "assistants");
  const meta = SECTIONS.find((entry) => entry.id === active) ?? null;

  useEffect(() => {
    document.title = documentTitle(meta ? `${meta.label} — Settings` : "Settings");
  }, [meta]);

  const nav = (
    <nav className="fm-settings__nav" aria-label="Settings sections">
      <List plain label="Settings sections">
        {SECTIONS.map((entry) => (
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

  const detail = meta ? (
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
        <h1 id="fm-settings-title" className="fm-settings__title">
          {meta.label}
        </h1>
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

  return (
    <div className={`fm-settings${columns === 1 ? " fm-settings--stack" : ""}`}>
      {columns === 1 ? (
        active === null ? (
          <>
            <header className="fm-settings__header">
              <h1 className="fm-settings__title">Settings</h1>
            </header>
            {nav}
          </>
        ) : (
          detail
        )
      ) : (
        <>
          {nav}
          {detail}
        </>
      )}
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
    case "sharing":
      return <SharingPane environmentId={environmentId} />;
    case "mac":
      return <YourMacPane environmentId={environmentId} />;
    case "appearance":
      return <AppearancePane />;
    case "privacy":
      return <PrivacyPane environmentId={environmentId} />;
    case "advanced":
      return <AdvancedPane />;
    case "about":
      return <AboutPane environmentId={environmentId} />;
  }
}
