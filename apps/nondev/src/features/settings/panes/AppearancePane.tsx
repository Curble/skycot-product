import { ADVANCED_MODE_LABEL, MASCOT_REFERENCE } from "../../../brand";
import type { MascotOverride } from "../../../plain/daylight";
import { Mascot } from "../../brand/Mascot";
import { ThemeGallery } from "../../../themes/ThemeGallery";
import { ListExtra, ListRow } from "../../../ui/ListRow";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { Switch } from "../../../ui/Switch";
import {
  useAppearanceMode,
  useMascotOverride,
  useTextSize,
  writeAppearanceMode,
  writeMascotOverride,
  writeTextSize,
  type AppearanceMode,
} from "../localPrefs";

type MascotChoice = "sky" | "day" | "dusk";
import { SettingsGroup } from "../SettingsGroup";

export function AppearancePane() {
  const mode = useAppearanceMode();
  const textSize = useTextSize();
  const mascot = useMascotOverride();
  return (
    <>
      <SettingsGroup
        title="Theme"
        footer="A theme changes how things look, never what they do. Hover a card to try it on; click to keep it. Themes are files you can share, and risky moments (approvals, undo, going live) stay plain in every theme."
      >
        <ListExtra>
          <ThemeGallery />
        </ListExtra>
      </SettingsGroup>
      <SettingsGroup
        title="Light or dark"
        footer={`System follows your Mac's light and dark setting. Your choice here also applies in ${ADVANCED_MODE_LABEL}; every theme has both a light and a dark side.`}
      >
        <ListExtra>
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
        </ListExtra>
      </SettingsGroup>
      <SettingsGroup
        title="Mascot"
        footer={`By day ${MASCOT_REFERENCE} sits in a blue morning sky; from dusk to dawn where you are, it switches to its twilight look with a star. Light or dark mode is separate.`}
      >
        <ListExtra>
          <div className="fm-setting-block fm-mascot-setting">
            <Mascot pose="hello" size={48} />
            <SegmentedControl<MascotChoice>
              label="Mascot"
              value={mascot ?? "sky"}
              onChange={(choice) => writeMascotOverride(toOverride(choice))}
              block
              options={[
                { value: "sky", label: "Follow the sky" },
                { value: "day", label: "Always day" },
                { value: "dusk", label: "Always dusk" },
              ]}
            />
          </div>
        </ListExtra>
      </SettingsGroup>
      <SettingsGroup
        title="Text size"
        footer="Larger text makes every word in the app about an eighth bigger; buttons and rows grow to fit, and sheets still fit the window. On by default for a Family profile."
      >
        <ListRow
          title="Larger text"
          subtitle={textSize === "large" ? "On" : "Off"}
          trailing={
            <Switch
              checked={textSize === "large"}
              onChange={(on) => writeTextSize(on ? "large" : "normal")}
              label="Larger text"
            />
          }
        />
      </SettingsGroup>
    </>
  );
}

function toOverride(choice: MascotChoice): MascotOverride {
  return choice === "sky" ? null : choice;
}
