// nondev-seam: skycot-ipad-child-app
/**
 * Child mode: the device always opens as that child. Make (Home), the fridge and the sticker
 * book; their own conversations from every linked Mac; "SKYCOT is asleep" over everything at
 * bedtime. No developer screens exist in this app at all: no terminal, no diffs, no pull
 * requests, no files outside the project, no "Allow for the session".
 */
import { View } from "react-native";

import { useChild } from "./ChildContext";
import { AsleepCover, useAsleep } from "../../screens/child/Asleep";
import { ChildHome, MyMakesScreen } from "../../screens/child/ChildHome";
import { FridgeScreen } from "../../screens/child/Fridge";
import { NewConversationScreen } from "../../screens/child/NewConversation";
import { StickersScreen } from "../../screens/child/Stickers";
import {
  AboutRoute,
  DemoRoute,
  demoOptions,
  ConversationRoute,
  MacsHeaderButton,
  MacsRoute,
  PageRoute,
  conversationOptions,
  pageOptions,
} from "../screens";
import { Shell, type ShellScreen, type ShellSection } from "../Shell";
import { useActivityMirror } from "../../activity/useActivityMirror";
import { CHILD_SIDEBAR_SECTIONS } from "../sidebarSections";

const SECTIONS: ReadonlyArray<ShellSection> = [
  { id: "make", title: "Make", symbol: "sparkles", route: "ChildHome" },
  {
    id: "fridge",
    title: "Fridge",
    symbol: "refrigerator",
    selectedSymbol: "refrigerator.fill",
    route: "Fridge",
  },
  {
    id: "stickers",
    title: "Stickers",
    symbol: "star",
    selectedSymbol: "star.fill",
    route: "Stickers",
  },
];

const SCREENS: ReadonlyArray<ShellScreen> = [
  { name: "ChildHome", component: ChildHome },
  { name: "MyMakes", component: MyMakesScreen, options: { title: "My makes" } },
  { name: "Fridge", component: FridgeScreen },
  { name: "Stickers", component: StickersScreen },
  { name: "Conversation", component: ConversationRoute, options: conversationOptions as never },
  {
    name: "NewConversation",
    component: NewConversationScreen,
    options: { title: "New conversation" },
  },
  { name: "Page", component: PageRoute, options: pageOptions as never },
  { name: "Macs", component: MacsRoute, options: { title: "This device" } },
  { name: "About", component: AboutRoute, options: { title: "About SKYCOT" } },
  ...(__DEV__ ? [{ name: "Demo" as const, component: DemoRoute, options: demoOptions }] : []),
];

const headerRight = () => <MacsHeaderButton />;

export function ChildApp() {
  const child = useChild();
  const asleep = useAsleep();
  useActivityMirror();
  return (
    <View style={{ flex: 1 }}>
      <Shell
        sections={SECTIONS}
        sidebarSections={CHILD_SIDEBAR_SECTIONS}
        screens={SCREENS}
        sidebarTitle="SKYCOT"
        {...(child.macs[0] ? { sidebarSubtitle: child.macs[0].me.deviceName } : {})}
        headerRight={headerRight}
      />
      {asleep ? <AsleepCover mac={asleep} /> : null}
    </View>
  );
}
