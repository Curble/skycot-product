/** The build flag as the running app sees it (see childMode.ts for the rules). */
import Constants from "expo-constants";

import { readChildModeFlag } from "./childMode";

export const CHILD_MODE_ENABLED: boolean = readChildModeFlag(Constants.expoConfig?.extra);
