import { ADVANCED_MODE_LABEL } from "../../../brand";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { useAppearanceMode, writeAppearanceMode, type AppearanceMode } from "../localPrefs";
import { SettingsGroup } from "../SettingsGroup";

export function AppearancePane() {
  const mode = useAppearanceMode();
  return (
    <SettingsGroup
      title="Appearance"
      footer={`System follows your Mac's light and dark setting. Your choice here also applies in ${ADVANCED_MODE_LABEL}.`}
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
  );
}
