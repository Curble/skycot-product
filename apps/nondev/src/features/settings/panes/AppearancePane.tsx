import { applyTheme, resolveIsDark } from "../../../app/theme";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { useAppearanceMode, writeAppearanceMode, type AppearanceMode } from "../localPrefs";
import { SettingsGroup } from "../SettingsGroup";

export function AppearancePane() {
  const mode = useAppearanceMode();
  const choose = (next: AppearanceMode) => {
    writeAppearanceMode(next);
    // Same-tab storage writes don't fire `storage`; repaint now.
    applyTheme(resolveIsDark(window.matchMedia("(prefers-color-scheme: dark)").matches));
  };
  return (
    <SettingsGroup
      title="Appearance"
      footer="System follows your Mac's light and dark setting. This is shared with Advanced mode."
    >
      <div className="fm-setting-block">
        <SegmentedControl<AppearanceMode>
          label="Appearance"
          value={mode}
          onChange={choose}
          block
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>
    </SettingsGroup>
  );
}
