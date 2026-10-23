import { registerRootComponent } from "expo";
import { LogBox } from "react-native";

import App from "./src/App";

// A development-only notice from React Native's animation driver, not from SKYCOT.
LogBox.ignoreLogs(["Sending `onAnimatedValueUpdate` with no listeners registered."]);

registerRootComponent(App);
