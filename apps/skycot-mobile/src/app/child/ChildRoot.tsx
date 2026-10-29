/**
 * Everything child mode needs at the root, in one file so App.tsx loads it only when the build
 * flag is on (`require` in App.tsx). With the flag off none of the child screens, and not the
 * speech module they import, are ever loaded.
 */
import { View } from "react-native";

import { useMacData } from "../../data/MacData";
import { StatusBar } from "react-native";
import { ThemeProvider, lookForChild, useTheme } from "../../ui/theme";
import { ChildApp } from "./ChildApp";
import { ChildProvider, useChild } from "./ChildContext";

function ChildLook(props: { readonly children: React.ReactNode }) {
  const child = useChild();
  const look = lookForChild(child.macs.map(child.childOn).find((entry) => entry !== null)?.look);
  return <ThemeProvider look={look}>{props.children}</ThemeProvider>;
}

function Bar() {
  const theme = useTheme();
  return <StatusBar barStyle={theme.dark ? "light-content" : "dark-content"} />;
}

export default function ChildRoot() {
  const { touched } = useMacData();
  return (
    <ChildProvider>
      <ChildLook>
        <Bar />
        {/* Notes a touch for the heartbeat (today's minutes count active use only). */}
        <View style={{ flex: 1 }} onTouchStart={touched}>
          <ChildApp />
        </View>
      </ChildLook>
    </ChildProvider>
  );
}
