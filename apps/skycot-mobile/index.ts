// Must stay first: the relay's crypto library looks for secure random numbers as it loads.
import "./src/polyfills";
import { registerRootComponent } from "expo";
import { LogBox } from "react-native";

import App from "./src/App";

// A development-only notice from React Native's animation driver, not from SKYCOT.
LogBox.ignoreLogs(["Sending `onAnimatedValueUpdate` with no listeners registered."]);

registerRootComponent(App);
