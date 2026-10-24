/**
 * SKYCOT for iPhone and iPad. One app: until a grown-up links it at the family's Mac it only
 * says how; once linked, the Mac's link decides whether it is a child's device (child mode,
 * Workshop look) or a grown-up's phone (grown-up mode). There is no account and no cloud.
 */
import { StatusBar, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ChildApp } from "./app/child/ChildApp";
import { ChildProvider, useChild } from "./app/child/ChildContext";
import { GrownUpApp } from "./app/grownup/GrownUpApp";
import { MacDataProvider, useMacData } from "./data/MacData";
import { FaceIdProvider } from "./faceid/FaceIdProvider";
import { DeepLinkProvider } from "./links/deepLinks";
import { LinksProvider, useLinks } from "./links/store";
import { WelcomeScreen } from "./screens/link/WelcomeScreen";
import { SignedOut } from "./screens/shared/SignedOut";
import { Spinner } from "./ui/kit";
import { PushRegistration } from "./push/PushRegistration";
import { WatchBridgeProvider } from "./watch/WatchBridge";
import { ThemeProvider, lookForChild, useTheme } from "./ui/theme";

function ChildLook(props: { readonly children: React.ReactNode }) {
  const child = useChild();
  const look = lookForChild(child.macs.map(child.childOn).find((entry) => entry !== null)?.look);
  return <ThemeProvider look={look}>{props.children}</ThemeProvider>;
}

function Bar() {
  const theme = useTheme();
  return <StatusBar barStyle={theme.dark ? "light-content" : "dark-content"} />;
}

function Root() {
  const links = useLinks();
  const { byMac, touched } = useMacData();
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
  if (links.mode === "child") {
    return (
      <ChildProvider>
        <ChildLook>
          <Bar />
          <TouchArea onTouch={touched}>
            <ChildApp />
          </TouchArea>
        </ChildLook>
      </ChildProvider>
    );
  }
  return (
    <ThemeProvider look="apple">
      <Bar />
      <GrownUpApp />
    </ThemeProvider>
  );
}

/** Notes a touch for the heartbeat (today's minutes count active use only, as on the Mac). */
function TouchArea(props: { readonly onTouch: () => void; readonly children: React.ReactNode }) {
  return (
    <View style={{ flex: 1 }} onTouchStart={props.onTouch}>
      {props.children}
    </View>
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
                <Root />
              </WatchBridgeProvider>
            </FaceIdProvider>
          </MacDataProvider>
        </LinksProvider>
      </DeepLinkProvider>
    </SafeAreaProvider>
  );
}
