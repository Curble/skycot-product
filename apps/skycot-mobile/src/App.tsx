/**
 * SKYCOT for iPhone and iPad. One app: until a grown-up links it at the family's Mac it only
 * says how; once linked, the Mac's link decides whether it is a grown-up's phone (grown-up
 * mode) or a child's device. Version 1 is a grown-up companion: child mode (Workshop look) is
 * behind the SKYCOT_MOBILE_CHILD_MODE build flag, off for store builds, and a child's device
 * shows a friendly note instead. There is no account and no cloud.
 */
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { rootChoice } from "./app/childMode";
import { CHILD_MODE_ENABLED } from "./app/childModeFlag";
import { GrownUpApp } from "./app/grownup/GrownUpApp";
import { MacDataProvider, useMacData } from "./data/MacData";
import { FaceIdProvider } from "./faceid/FaceIdProvider";
import { DeepLinkProvider } from "./links/deepLinks";
import { LinksProvider, useLinks } from "./links/store";
import { WelcomeScreen } from "./screens/link/WelcomeScreen";
import { ChildDeviceNote } from "./screens/shared/ChildDeviceNote";
import { SignedOut } from "./screens/shared/SignedOut";
import { Spinner } from "./ui/kit";
import { SampleFrame } from "./sample/SampleBanner";
import { PushRegistration } from "./push/PushRegistration";
import { WatchBridgeProvider } from "./watch/WatchBridge";
import { ThemeProvider, useTheme } from "./ui/theme";

function Bar() {
  const theme = useTheme();
  return <StatusBar barStyle={theme.dark ? "light-content" : "dark-content"} />;
}

function Root() {
  const links = useLinks();
  const { byMac } = useMacData();
  if (!links.ready) return <Spinner />;
  if (links.mode === "unlinked") {
    return (
      <ThemeProvider look="apple">
        <Bar />
        <WelcomeScreen />
      </ThemeProvider>
    );
  }
  const gone = links.macs.filter((mac) => byMac[mac.macId]?.signedOut === true);
  if (gone.length === links.macs.length) {
    return (
      <ThemeProvider look="apple">
        <Bar />
        <SignedOut macs={gone} />
      </ThemeProvider>
    );
  }
  const choice = rootChoice(links.mode, CHILD_MODE_ENABLED);
  if (choice === "child-note") {
    return (
      <ThemeProvider look="apple">
        <Bar />
        <ChildDeviceNote macs={links.macs} />
      </ThemeProvider>
    );
  }
  if (choice === "child") {
    // Loaded only when child mode is built in, so a grown-up-only build never starts the speech
    // module or any child screen.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ChildRoot = (require("./app/child/ChildRoot") as typeof import("./app/child/ChildRoot"))
      .default;
    return <ChildRoot />;
  }
  return (
    <ThemeProvider look="apple">
      <Bar />
      <GrownUpApp />
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <DeepLinkProvider>
        <LinksProvider>
          <MacDataProvider>
            <FaceIdProvider>
              <WatchBridgeProvider>
                <PushRegistration />
                <SampleFrame>
                  <Root />
                </SampleFrame>
              </WatchBridgeProvider>
            </FaceIdProvider>
          </MacDataProvider>
        </LinksProvider>
      </DeepLinkProvider>
    </SafeAreaProvider>
  );
}
