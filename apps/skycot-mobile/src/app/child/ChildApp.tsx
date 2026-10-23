/**
 * Child mode: the device always opens as that child. Make (Home), the fridge and the sticker
 * book; their own conversations from every linked Mac; "SKYCOT is asleep" over everything at
 * bedtime. No developer screens exist in this app at all: no terminal, no diffs, no pull
 * requests, no files outside the project, no "Allow for the session".
 */
import { View } from "react-native";

import { useChild } from "./ChildContext";
import { conversationRows, rowLabel } from "../../data/conversations";
import { useMacData } from "../../data/MacData";
import { AsleepCover, useAsleep } from "../../screens/child/Asleep";
import { ChildHome } from "../../screens/child/ChildHome";
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
  const { byMac } = useMacData();
  const asleep = useAsleep();
  const rows = conversationRows(child.macs, byMac, child.questionsRoots);
  useActivityMirror();
  return (
    <View style={{ flex: 1 }}>
      <Shell
        sections={SECTIONS}
        screens={SCREENS}
        sidebarTitle="SKYCOT"
        {...(child.macs[0] ? { sidebarSubtitle: child.macs[0].me.deviceName } : {})}
        sidebarItemsTitle="My conversations"
        sidebarItems={rows.slice(0, 30).map((row) => ({
          key: row.key,
          title: row.thread.title,
          subtitle: rowLabel(row, child.macs.length > 1),
          symbol:
            row.state === "waiting"
              ? "hand.raised.fill"
              : row.state === "working"
                ? "hammer.fill"
                : "bubble.left",
          open: {
            name: "Conversation",
            params: { macId: row.mac.macId, threadId: row.thread.id, title: row.thread.title },
            title: row.thread.title,
          },
        }))}
        headerRight={headerRight}
      />
      {asleep ? <AsleepCover mac={asleep} /> : null}
    </View>
  );
}
