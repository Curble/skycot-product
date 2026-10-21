import { ADVANCED_MODE_LABEL } from "../../../brand";
import { ThemeGallery } from "../../../themes/ThemeGallery";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { useAppearanceMode, writeAppearanceMode, type AppearanceMode } from "../localPrefs";
import { SettingsGroup } from "../SettingsGroup";

export function AppearancePane() {
  const mode = useAppearanceMode();
  return (
    <>
      <SettingsGroup
        title="Theme"
        footer="A theme changes how things look, never what they do. Hover a card to try it on; click to keep it. Themes are files you can share, and risky moments (approvals, undo, going live) stay plain in every theme."
      >
        <ThemeGallery />
      </SettingsGroup>
      <SettingsGroup
        title="Light or dark"
        footer={`System follows your Mac's light and dark setting. Your choice here also applies in ${ADVANCED_MODE_LABEL}; every theme has both a light and a dark side.`}
      >
        <div className="fm-setting-block">
          <SegmentedControl<AppearanceMode>
            label="Appearance"
            value={mode}
            onChange={writeAppearanceMode}
            block
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </div>
      </SettingsGroup>
    </>
  );
}
